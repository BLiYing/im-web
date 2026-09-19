// im-rtc 接入配置：全部来自 Vite 环境变量（`.env.local`，被 `*.local` 忽略、不进提交）。
//
//   VITE_RTC_WS_URL        信令地址（ws:// 或 wss://，含 /v1/ws）
//   VITE_RTC_APP_ID        SDKAppID
//   VITE_RTC_KEY_ID        调试密钥 ID（dbg- 开头）
//   VITE_RTC_DEBUG_SECRET  调试密钥（**仅联调**：本地签接入票；上线换成后端 POST /v1/tokens）
//
// 缺任何一项 ⇒ 通话入口整体不可用（点按钮只提示未配置），不影响 IM 本身。

export interface RtcConfig {
  wsUrl: string;
  appId: string;
  keyId: string;
  debugSecret: string;
}

/** 缺哪项就返回哪项的说明；齐全返回 null。纯函数，便于单测。 */
export function rtcConfigProblem(c: Partial<RtcConfig>): string | null {
  if (!c.wsUrl) return "缺 VITE_RTC_WS_URL";
  if (!/^wss?:\/\//.test(c.wsUrl)) return "VITE_RTC_WS_URL 必须以 ws:// 或 wss:// 开头";
  if (!c.appId) return "缺 VITE_RTC_APP_ID";
  if (!c.keyId) return "缺 VITE_RTC_KEY_ID";
  if (!c.keyId.startsWith("dbg-")) return "VITE_RTC_KEY_ID 必须以 dbg- 开头";
  if (!c.debugSecret) return "缺 VITE_RTC_DEBUG_SECRET";
  return null;
}

/** 读环境变量；不完整时返回 null。 */
export function loadRtcConfig(env: Record<string, string | undefined> = import.meta.env): RtcConfig | null {
  const c: Partial<RtcConfig> = {
    wsUrl: env.VITE_RTC_WS_URL?.trim(),
    appId: env.VITE_RTC_APP_ID?.trim(),
    keyId: env.VITE_RTC_KEY_ID?.trim(),
    debugSecret: env.VITE_RTC_DEBUG_SECRET?.trim(),
  };
  return rtcConfigProblem(c) === null ? (c as RtcConfig) : null;
}
