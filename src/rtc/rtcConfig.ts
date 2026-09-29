// im-rtc 接入配置：信令地址来自 Vite 环境变量（`.env.local`，被 `*.local` 忽略、不进提交）。
//
//   VITE_RTC_WS_URL  信令地址（ws:// 或 wss://，含 /v1/ws）
//
// 接入票不再由本端签发，改由 IMServer 的 POST /api/v1/rtc/token 代为向 im-rtc-server 换票
// （见 rtcEngine.ts 的 signToken）——本端既不需要也不该知道 SDKAppID / SDKSecretKey。
//
// 缺 VITE_RTC_WS_URL ⇒ 通话入口整体不可用（点按钮只提示未配置），不影响 IM 本身。

export interface RtcConfig {
  wsUrl: string;
}

/** 缺哪项就返回哪项的说明；齐全返回 null。纯函数，便于单测。 */
export function rtcConfigProblem(c: Partial<RtcConfig>): string | null {
  if (!c.wsUrl) return "缺 VITE_RTC_WS_URL";
  if (!/^wss?:\/\//.test(c.wsUrl)) return "VITE_RTC_WS_URL 必须以 ws:// 或 wss:// 开头";
  return null;
}

/** 读环境变量；不完整时返回 null。 */
export function loadRtcConfig(env: Record<string, string | undefined> = import.meta.env): RtcConfig | null {
  const c: Partial<RtcConfig> = { wsUrl: env.VITE_RTC_WS_URL?.trim() };
  return rtcConfigProblem(c) === null ? (c as RtcConfig) : null;
}
