// sysSegments：系统消息（content_type="system"）结构化分段的解析。
//
// 服务端生成系统消息时只能填公开昵称（那句话全群共享），所以「我给他设的备注」和「点名字跳资料页」
// 都做不到。分段把「哪一段是谁的名字」随消息下发，收端据此本地重渲染 + 挂点击。
// 详见 ../IMServer/docs/PROTOCOL.md「系统消息分段」与 protocol.SysSegment。

import type { SysSegment } from "./sdk/protocol";

/** 解析系统消息分段（脏数据安全）：丢掉非对象/无 text 的项；一段都不剩返回 undefined（回退整句）。 */
export function parseSysSegments(raw: unknown): SysSegment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SysSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { uid, text } = item as { uid?: unknown; text?: unknown };
    if (typeof text !== "string" || text.length === 0) continue;
    out.push(typeof uid === "string" && uid.length > 0 ? { uid, text } : { text });
  }
  return out.length > 0 ? out : undefined;
}

/** 分段拼回整句（应与服务端落库的 content 一致）；无分段返回 undefined 交调用方回退 content。 */
export function sysSegmentsText(segs: SysSegment[] | undefined): string | undefined {
  return segs?.length ? segs.map((s) => s.text).join("") : undefined;
}

/** 系统消息名字段在**本机**的显示名。唯一硬规则：**是我自己就显示「我」**——
 *  「用户1002 将 用户3001 移出群聊」里那个 `用户1002` 就是登录者本人，照着服务端字面显示读起来像在说别人。
 *  其余交给 resolve（备注 > 群昵称 > 昵称 > 服务端字面）。
 *  聊天页系统行与会话列表预览是**同一句话**，共用本函数以免两处口径漂移（一处「我」一处自己的昵称）。 */
export function sysSegmentName(uid: string, selfUid: string, resolve: (uid: string) => string): string {
  return uid.length > 0 && uid === selfUid ? "我" : resolve(uid);
}
