// token 生命周期：拿一枚可用的 access token、用长效凭据续期、并发续期合并。
// 对齐 iOS `IMHTTPService+Auth.m`（同一套判据：探活 → 续期 → 才是凭据登录）。
//
// **为什么不长在 IMClient 里**：① `imSdk.ts` 有行数硬预算（`check-file-size.sh`，同 `sdk/wake.ts`
// 与 `sdk/resend.ts` 出走的理由）；② 这里全是**可注入依赖的纯决策**，能脱开 WebSocket 单测，
// 而类里只剩「拿到 token 之后干什么」。IMClient 侧只留两个接线口：`fetchToken` / `renewToken`。
//
// 三条取 token 的路，优先级即安全序：
//   ① 手上这枚还有效 → 直接复用（顺带在重登之前发现「被踢下线」，见 probe 注释）；
//   ② 有 refresh_token → `POST /token/refresh` 免密续期（**常态**，2026-09-06 起两类会话都有）；
//   ③ 才轮到 `POST /login`——只剩两种情形：首次登录，和老会话里那份明文密码的一次性迁移。
import { fetchEnvelope } from "./http";
import { friendlyMessage } from "./errcode";

/** 鉴权类业务码：拿到这些说明「这枚凭据永远不会再好起来」，重试无意义。 */
export const CODE_TOKEN_REVOKED = 100101; // 会话被吊销 / 被踢下线
export const CODE_TOKEN_EXPIRED = 100102; // token 自然过期

/** 本次（重）连可用的凭据全集。字段皆可为空，`acquireToken` 按上面的优先级择路。 */
export interface TokenCredentials {
  /** 手上这枚 access token（可能已过期或已被吊销）。 */
  token: string;
  /** 长效续期凭据；空=本会话不可续期（会话登记降级 / 上线前的老会话）。 */
  refreshToken: string;
  /** 登录凭据（公开句柄）。 */
  username: string;
  /** 明文密码。**只应来自首次登录表单或老会话的一次性迁移**；空=不可回退密码登录。 */
  password: string;
  /** 扫码会话：无密码可回退。 */
  qrSession: boolean;
  /** 登录设备字段，随 `/login` 上报（扫码路径由票据透传，不走这里）。 */
  device: { deviceId: string; deviceName: string };
}

export interface TokenResult {
  token: string;
  uid: string;
  /** 仅 `/login` 会下发；续期接口刻意不轮换（见后端 `handleTokenRefresh` 注释）。 */
  refreshToken?: string;
}

/** 带业务码的错误：`.code` 供调用方区分「鉴权失败(退登录)」与「网络问题(重试)」。 */
function authError(code: number, message: string): Error & { code?: number } {
  const e = new Error(friendlyMessage(code, message)) as Error & { code?: number };
  e.code = code;
  return e;
}

/** 该业务码是否意味着凭据已死（重试/续期都救不回来）。 */
export function isDeadCredential(code: number | undefined): boolean {
  return code === CODE_TOKEN_REVOKED || code === CODE_TOKEN_EXPIRED
    || code === 200001 || code === 200002 || code === 200003; // 账号不存在 / 密码错 / 被封
}

/**
 * 用长效凭据换一枚新的 access token（`POST /api/v1/token/refresh`，免鉴权）。
 * 成功回 `{token, uid}`；失败抛带 `.code` 的 Error——`isDeadCredential(code)` 为真时
 * 这枚 refresh_token 已死，调用方须擦掉它并回登录页（继续拿它重试只会每次都撞同一堵墙）。
 */
export async function renewWithRefresh(refreshToken: string): Promise<{ token: string; uid: string }> {
  const body = await fetchEnvelope<{ token?: string; uid?: string }>("/api/v1/token/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (body.code !== 0 || !body.data?.token || !body.data?.uid) {
    throw authError(body.code, body.message ?? "续期失败");
  }
  return { token: body.data.token, uid: body.data.uid };
}

/**
 * 取本次（重）连要用的 token。
 *
 * **探活先于一切**：手上有 token 时先拿它打一次 `/devices`，好在重登之前发现吊销——
 * 否则密码会话重连直接 `/login` 会重新签发新会话，把「踢下线」自愈掉（这条判据是 2026-08 那次
 * 修复的核心，改动本函数时勿丢）。`100101` 一律抛（两类会话都强制回登录）；其它失效才往下走。
 */
export async function acquireToken(c: TokenCredentials, uid: string): Promise<TokenResult> {
  if (c.token) {
    const probe = await fetchEnvelope("/api/v1/devices", {
      headers: { Authorization: `Bearer ${c.token}` },
    });
    if (probe.code === 0) return { token: c.token, uid }; // 仍有效，复用（身份不变）
    if (probe.code === CODE_TOKEN_REVOKED) throw authError(probe.code, probe.message ?? "登录已失效");
  }

  // 续期：常态路径。凭据被明确拒绝时**不再往下试密码**——扫码会话压根没有密码，
  // 而密码会话若也走到这里，说明服务端认定这条会话已死（吊销/封号），拿密码重登只会
  // 悄悄新建一条会话，把「已被注销」洗成「又登上了」。
  if (c.refreshToken) {
    const renewed = await renewWithRefresh(c.refreshToken);
    return { token: renewed.token, uid: renewed.uid };
  }

  // 扫码会话无密码可回退：任何失效都救不了 → 回登录页。
  if (c.qrSession || !c.username) {
    throw authError(CODE_TOKEN_EXPIRED, "登录已失效");
  }

  const body = await fetchEnvelope<{ token?: string; uid?: string; refresh_token?: string }>("/api/v1/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: c.username, password: c.password, platform: "web",
      device_id: c.device.deviceId, device_name: c.device.deviceName,
    }),
  });
  if (body.code !== 0 || !body.data?.token || !body.data?.uid) {
    throw authError(body.code, body.message ?? "登录失败");
  }
  // data.uid 是服务端分配的内部 ID；首次登录前本端并不知道自己是谁。
  return { token: body.data.token, uid: body.data.uid, refreshToken: body.data.refresh_token ?? "" };
}

/** 单飞续期器：并发调用共享同一发在途请求，返回新 token（空串=救不了）。 */
export type Renewer = () => Promise<string>;

/**
 * 造一个「过期救援」续期器，供 HTTP 层在撞上 `100102` 时调用。
 *
 * **必须单飞**：一次页面加载能并发打出五六个 REST 请求，token 一旦过期它们会同时撞 100102；
 * 不合并就是五六发 `/token/refresh`。后端刻意不轮换凭据（并发续期时轮换必有一方拿到废凭据被
 * 误踢），所以并发在服务端是安全的——但客户端没有理由制造它。
 *
 * 失败一律**吞掉**返回空串：救援是尽力而为，原始那个 100102 会照常抛给业务调用方。
 * 唯一有副作用的分支是凭据已死——此时调 `onDead`，由上层擦凭据 + 回登录页（对齐 iOS：
 * 不擦的话每次进页面都拿同一枚废凭据重试，界面永远"未连接"且没有任何出路）。
 */
export function createRenewer(opts: {
  getRefreshToken: () => string;
  onRenewed: (token: string, uid: string) => void;
  onDead: (code: number, message: string) => void;
  renew?: typeof renewWithRefresh;
}): Renewer {
  const renew = opts.renew ?? renewWithRefresh;
  let inFlight: Promise<string> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const refreshToken = opts.getRefreshToken();
    if (!refreshToken) return Promise.resolve("");
    inFlight = renew(refreshToken)
      .then(({ token, uid }) => { opts.onRenewed(token, uid); return token; })
      .catch((e: Error & { code?: number }) => {
        if (isDeadCredential(e.code)) opts.onDead(e.code!, e.message);
        return "";
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}
