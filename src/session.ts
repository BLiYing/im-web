// 保持登录（与 iOS IMSessionStore 一致的 dev 骨架）：登录成功落 localStorage，刷新后静默重登。
// 存凭据而非 token——token 24h 过期且断线重连本就要用密码重新换 token；生产应换更安全的方案。
export const SESSION_KEY = "im.session";

export function loadSession(): { uid: string; pwd: string; token?: string } | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!s || typeof s.uid !== "string" || !s.uid) return null;
    // token=扫码登录会话（无密码）；pwd=密码/免密会话。二者其一。
    return { uid: s.uid, pwd: typeof s.pwd === "string" ? s.pwd : "", token: typeof s.token === "string" ? s.token : undefined };
  } catch { return null; }
}
