// im-rtc 引擎的创建与销毁（宿主侧）：登录后建、退出登录后销毁；换票与被踢的处置也在这里。
//
// **接入票只有一个来源：signToken**。调 IMServer 的 POST /api/v1/rtc/token 代为向 im-rtc-server
// 换票——本端只带上当前 IM 会话的 Bearer token，device_id 由 IMServer 从登录会话登记值里取，
// 不由本端传（且天然与 CallEngine 构造用的 `platform().deviceId()` 是同一个值，登录帧本就用它）。
import {
  CallEngine, VideoProfiles, WebRTCAdapter, setLogLevel, setLogSink,
} from "im-rtc-call-engine";
import { callJson } from "../sdk/http";
import { logger, LOG_TAG } from "../logging/logger";
import { platform } from "../platform";
import { loadRtcConfig } from "./rtcConfig";

const browserMediaSource = {
  getStream: (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints),
};

/** POST /api/v1/rtc/token 的响应体（IMServer `rtcTokenData`，见 IMServer docs/PROTOCOL.md）。 */
interface RTCTokenData {
  token: string;
  expires_at_ms: number;
  expires_in_sec: number;
}

/**
 * 接入票唯一来源：调 IMServer 换票。
 *
 * `getAuthToken` 取的是**当前**IM 会话的 Bearer token（不是登录那一刻的快照）——换票会在
 * 初次登录与断线重连（下方 disconnected code=4401）两个时刻发生，中间 IM 会话可能已经续过期，
 * 用旧闭包值会拿着一枚已失效的 token 去换，白白多一轮失败。
 *
 * `signal` 可选：初次登录时由 `startRtcEngine` 透传，供调用方中止在途请求（见该函数注释）；
 * 续票（disconnected code=4401）不传——那时引擎已经登录成功，没有"这次调用被取消"的概念。
 */
export async function signToken(getAuthToken: () => string, signal?: AbortSignal): Promise<string> {
  const authToken = getAuthToken();
  if (!authToken) throw new Error("尚未登录 IM，无法换取音视频接入票");
  const data = (await callJson("/api/v1/rtc/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: "{}",
    signal,
  })) as RTCTokenData;
  if (!data?.token) throw new Error("换票响应缺少 token");
  return data.token;
}

/** 把 SDK 日志接进本端 logger（开发期会随 logger 的 dev sink 落到 IMServer 日志文件）。 */
function installSdkLog(): void {
  setLogLevel("debug");
  setLogSink((level, message, fields) => {
    const l = level === "error" ? "error" : level === "warn" ? "warn" : "debug";
    logger[l](LOG_TAG.rtc, message, fields as Record<string, unknown>);
  });
}

export interface RtcHandle {
  engine: CallEngine;
  /** 销毁：退订并退出登录。幂等。 */
  dispose: () => void;
}

/**
 * 建引擎并登录。配置不全返回 null；登录失败也返回 null（已记日志，不打扰 IM）。
 * `getAuthToken`：取当前 IM 会话 Bearer token 的稳定函数（见 signToken 注释）。
 * `onDead`：被踢 / 换票换不上——引擎已死，宿主该决定怎么办（这里只记日志并让调用方丢弃句柄）。
 * `signal`：可选，调用方（`RtcHost`）传入，用来中止**初次登录**这次换票请求——React
 * StrictMode 会把挂载 effect 连续跑两次（mount → cleanup → mount，几乎无间隔），不传的话
 * 第一次那份 `POST /api/v1/rtc/token` 请求已经真的发出去了却被 `cancelled` 标记直接丢弃结果，
 * 调试密钥时代这只是白算一次 HMAC（无网络开销），换成真实换票后会白打一次 IMServer + 消耗
 * im-rtc-server 的换票配额。cleanup 调 `controller.abort()`，这里请求会以 AbortError 结束、
 * 走 catch 分支静默 dispose，不会误伤"真正被保留"的那次调用（那次有自己独立的 controller）。
 */
export async function startRtcEngine(
  uid: string,
  getAuthToken: () => string,
  onDead: () => void,
  signal?: AbortSignal,
): Promise<RtcHandle | null> {
  const cfg = loadRtcConfig();
  if (!cfg) return null;
  installSdkLog();
  const deviceId = platform().deviceId();
  const engine = new CallEngine({
    url: cfg.wsUrl,
    deviceId,
    media: new WebRTCAdapter(browserMediaSource, VideoProfiles.p1080),
  });

  let refreshing = false;
  const offs = [
    engine.on("connected", () => { refreshing = false; }),
    engine.on("disconnected", (e) => {
      if (e.code !== 4401 || refreshing) return;
      refreshing = true;
      void signToken(getAuthToken)
        .then((t) => engine.updateToken(t))
        .catch((err: unknown) => {
          refreshing = false;
          logger.warn(LOG_TAG.rtc, "token_refresh_failed", { err: String(err) });
        });
    }),
    engine.on("kickedOut", () => {
      logger.warn(LOG_TAG.rtc, "rtc_kicked_out");
      onDead();
    }),
  ];

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    offs.forEach((off) => off());
    engine.logout();
  };
  try {
    await engine.login(await signToken(getAuthToken, signal));
    logger.info(LOG_TAG.rtc, "rtc_start", { url: cfg.wsUrl, uid });
    return { engine, dispose };
  } catch (err) {
    logger.error(LOG_TAG.rtc, "rtc_login_failed", { err: String(err) });
    dispose();
    return null;
  }
}
