// im-rtc 引擎的创建与销毁（宿主侧）：登录后建、退出登录后销毁。**登录归 Kit**（im-rtc 2.2.0 的
// `<CallProvider tokenProvider>`）：取票登录、失败退避重试、拨号前补登录、续票、票失效重登都由它做，
// 这里只提供「怎么取票」（rtcTokenProvider）。
//
// **接入票只有一个来源：signToken**。调 IMServer 的 POST /api/v1/rtc/token 代为向 im-rtc-server
// 换票——本端只带上当前 IM 会话的 Bearer token，device_id 由 IMServer 从登录会话登记值里取，
// 不由本端传（且天然与 CallEngine 构造用的 `platform().deviceId()` 是同一个值，登录帧本就用它）。
import {
  CallEngine, VideoProfiles, WebRTCAdapter, setLogLevel, setLogSink,
} from "im-rtc-call-engine";
import type { TokenProvider } from "im-rtc-call-uikit-react";
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
 * `getAuthToken` 取的是**当前**IM 会话的 Bearer token（不是登录那一刻的快照）——Kit 会在启动、
 * 失败重试、拨号前补登录、续票等多个时刻来取票，中间 IM 会话可能已经续过期，用旧闭包值会拿着
 * 一枚已失效的 token 去换，白白多一轮失败。
 *
 * `signal` 可选：供调用方中止在途请求。
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

/** 交给 Kit 的取票函数（`<CallProvider tokenProvider>`）：失败就 reject，Kit 据此退避重试 / 给用户提示。 */
export function rtcTokenProvider(getAuthToken: () => string): TokenProvider {
  return async () => {
    try {
      return { token: await signToken(getAuthToken) };
    } catch (err) {
      logger.warn(LOG_TAG.rtc, "rtc_sign_failed", { err: String(err) });
      throw err;
    }
  };
}

export interface RtcHandle {
  engine: CallEngine;
  /** 销毁：退订并退出登录。幂等。 */
  dispose: () => void;
}

/**
 * 建引擎（**不登录**，登录归 Kit 的 tokenProvider）。配置不全返回 null。
 * `onDead`：被顶号 / 配置被拒——换票救不了，宿主丢弃这台引擎（票失效被踢由 Kit 自己换票重登，不走这里）。
 */
export function createRtcEngine(uid: string, onDead: () => void): RtcHandle | null {
  const cfg = loadRtcConfig();
  if (!cfg) return null;
  installSdkLog();
  const deviceId = platform().deviceId();
  const engine = new CallEngine({
    url: cfg.wsUrl,
    deviceId,
    media: new WebRTCAdapter(browserMediaSource, VideoProfiles.p1080),
  });
  const offs = [
    engine.on("kickedOut", ({ reason }) => {
      logger.warn(LOG_TAG.rtc, "rtc_kicked_out", { reason });
      if (reason !== "authExpired") onDead();
    }),
  ];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    offs.forEach((off) => off());
    engine.logout();
  };
  logger.info(LOG_TAG.rtc, "rtc_start", { url: cfg.wsUrl, uid });
  return { engine, dispose };
}
