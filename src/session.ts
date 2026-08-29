// 保持登录（与 iOS IMSessionStore 一致的 dev 骨架）：登录成功落 localStorage，刷新后静默重登。
// 存凭据而非 token——token 24h 过期且断线重连本就要用密码重新换 token；生产应换更安全的方案。
//
// **uid 与 username 是两个字段，都得存**（服务端账号体系重构后，见
// IMServer/docs/ACCOUNT_IDENTITY_REDESIGN.md）：
//   - uid：服务端分配的 10 位数字**内部 ID**。本地库分区、conv_id 推导、接口参数都用它。
//   - username：用户自己起的公开句柄，**只用于重新登录**（登录接口不认内部 ID）。
// 只存 uid 会让刷新后的静默重登拿内部 ID 去 /login，后端按 username 查必然落空。
export const SESSION_KEY = "im.session";

export type SavedSession = { uid: string; username: string; pwd: string; token?: string };

export function loadSession(): SavedSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!s || typeof s.uid !== "string" || !s.uid) return null;
    // token=扫码登录会话（无密码）；pwd=密码/免密会话。二者其一。
    return {
      uid: s.uid,
      // username 缺失时回退 uid：扫码登录路径本就没有 username（票据里只有内部 ID），
      // 它靠 token 重连、不走 /login，回退值不会被真正用来登录。
      username: typeof s.username === "string" && s.username ? s.username : s.uid,
      pwd: typeof s.pwd === "string" ? s.pwd : "",
      token: typeof s.token === "string" ? s.token : undefined,
    };
  } catch { return null; }
}

/** 落盘一次会话。token 与 pwd 二选一（扫码 vs 密码/免密）。 */
export function saveSession(s: SavedSession): void {
  const payload = s.token
    ? { uid: s.uid, username: s.username, token: s.token }
    : { uid: s.uid, username: s.username, pwd: s.pwd };
  localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}
