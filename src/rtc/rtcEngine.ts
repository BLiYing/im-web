// im-rtc 引擎的创建与销毁（宿主侧）：登录后建、退出登录后销毁；换票与被踢的处置也在这里。
//
// **接入票只有一个来源：signToken**。现在是调试密钥本地签（联调用）；IMServer 换票接口上线后，
// 只改这一个函数，其余不动。
import {
  CallEngine, VideoProfiles, WebRTCAdapter, generateDebugToken, setLogLevel, setLogSink,
} from "im-rtc-call-engine";
import { logger, LOG_TAG } from "../logging/logger";
import { platform } from "../platform";
import { loadRtcConfig, type RtcConfig } from "./rtcConfig";

const browserMediaSource = {
  getStream: (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints),
};

/** 接入票唯一来源（联调：调试密钥本地签）。 */
async function signToken(cfg: RtcConfig, uid: string, deviceId: string): Promise<string> {
  logger.warn(LOG_TAG.rtc, "debug_token_signing", { kid: cfg.keyId, note: "仅联调，上线换后端换票" });
  return generateDebugToken({ appId: cfg.appId, keyId: cfg.keyId, secret: cfg.debugSecret, uid, deviceId });
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
 * `onDead`：被踢 / 换票换不上——引擎已死，宿主该决定怎么办（这里只记日志并让调用方丢弃句柄）。
 */
export async function startRtcEngine(uid: string, onDead: () => void): Promise<RtcHandle | null> {
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
      void signToken(cfg, uid, deviceId)
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
    await engine.login(await signToken(cfg, uid, deviceId));
    logger.info(LOG_TAG.rtc, "rtc_start", { app: cfg.appId, url: cfg.wsUrl });
    return { engine, dispose };
  } catch (err) {
    logger.error(LOG_TAG.rtc, "rtc_login_failed", { err: String(err) });
    dispose();
    return null;
  }
}
