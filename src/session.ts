// 保持登录：登录成功落 localStorage，刷新后静默重登。
//
// **2026-09-06 起不再存账号明文密码**（与 iOS `IMSessionStore` 同一次整改）。改存后端签发的
// `refresh_token`：绑定本设备会话、可吊销、180 天绝对寿命。存密码的问题不是"泄露风险大一点"，
// 而是攻击者拿到的是**密码**而不是会话——App 里那套「设备管理 / 注销某台设备」对它完全失效
// （注销掉的只是会话，对方用密码立刻重登）。凭据绑定 sid 之后，「踢下线」「改密码后下线其它
// 设备」「封号」三条既有通路才真正覆盖到"保持登录"。
//
// **uid 与 username 是两个字段，都得存**（服务端账号体系重构后，见
// IMServer/docs/ACCOUNT_IDENTITY_REDESIGN.md）：
//   - uid：服务端分配的 10 位数字**内部 ID**。本地库分区、conv_id 推导、接口参数都用它。
//   - username：用户自己起的公开句柄，**只用于重新登录**（登录接口不认内部 ID）。
// 只存 uid 会让刷新后的静默重登拿内部 ID 去 /login，后端按 username 查必然落空。
export const SESSION_KEY = "im.session";

export type SavedSession = {
  uid: string;
  username: string;
  /** 长效续期凭据：冷启动免密换新 access token（POST /api/v1/token/refresh）。 */
  refresh: string;
  /** 扫码登录换来的 access token（首次入场直接用它连；续期仍靠 refresh）。 */
  token?: string;
  /** **一次性迁移垫片**：改版前存下的明文密码。有它没 refresh 时，用它做最后一次密码登录换回
   *  refresh，随后 `saveSession` 就再也不会写它了（新结构里压根没有这个字段）。 */
  legacyPwd?: string;
};

export function loadSession(): SavedSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!s || typeof s.uid !== "string" || !s.uid) return null;
    return {
      uid: s.uid,
      // username 缺失时回退 uid：扫码登录路径本就没有 username（票据里只有内部 ID），
      // 它靠 token/refresh 重连、不走 /login，回退值不会被真正用来登录。
      username: typeof s.username === "string" && s.username ? s.username : s.uid,
      refresh: typeof s.refresh === "string" ? s.refresh : "",
      token: typeof s.token === "string" ? s.token : undefined,
      legacyPwd: typeof s.pwd === "string" && s.pwd ? s.pwd : undefined,
    };
  } catch { return null; }
}

/** 落盘一次会话。**只写 refresh / token，绝不写密码**——迁移垫片是只读的（见 legacyPwd）。 */
export function saveSession(s: SavedSession): void {
  const payload: Record<string, string> = { uid: s.uid, username: s.username };
  if (s.refresh) payload.refresh = s.refresh;
  if (s.token) payload.token = s.token;
  localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}
