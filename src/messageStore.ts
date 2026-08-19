// 会话消息表的**纯变换**（无 React、无 self）——去重/合并/patch/删除那套曾散在 App handlers 里的逻辑，
// 抽成纯函数以便单测（`messageStore.test.ts`）。所有函数 immutable：不改入参，返回新 map；无变化时**原样返回**
// 同一引用（省一次渲染）。有状态的 hook 外壳见 `useMessageStore`。
import type { ChatMessage } from "./sdk/protocol";

/** 会话 id → 该会话消息列表（按到达顺序）。 */
export type MsgMap = Record<string, ChatMessage[]>;

/** 追加一条消息到某会话尾部。 */
export function appendTo(map: MsgMap, convId: string, m: ChatMessage): MsgMap {
  return { ...map, [convId]: [...(map[convId] ?? []), m] };
}

/** 单会话内按 clientMsgId 就地打补丁（会话不存在 → 原样返回）。相册占位换真 URL/ID 用。 */
export function patchByClientMsgId(map: MsgMap, cid: string, clientMsgId: string, patch: Partial<ChatMessage>): MsgMap {
  const list = map[cid];
  if (!list) return map;
  return { ...map, [cid]: list.map((m) => (m.clientMsgId === clientMsgId ? { ...m, ...patch } : m)) };
}

/**
 * 跨**所有**会话，对匹配 clientMsgId 的消息应用 fn（ack/被拒回执无会话定位，只能全表扫 clientMsgId）。
 * fn 拿到 (消息, 所在 cid)——ack 需要 cid 去登记去重集，故回传 cid。
 */
export function mapMatchingClientMsgId(map: MsgMap, clientMsgId: string, fn: (m: ChatMessage, cid: string) => ChatMessage): MsgMap {
  const out: MsgMap = {};
  for (const [cid, list] of Object.entries(map)) {
    out[cid] = list.map((m) => (m.clientMsgId === clientMsgId ? fn(m, cid) : m));
  }
  return out;
}

/**
 * 把入站权威消息的元数据合并进**已存在**的同 conv_seq 消息（去重命中路径）：
 * ACK/另一条同步路径可能先建了同序号消息，权威重拉仍需把 server_msg_id / 文件元数据 / 撤回·编辑·置顶态补上屏。
 * 只覆盖“有值才盖”，不把已确认字段清空。
 */
export function mergeMetaBySeq(map: MsgMap, convId: string, m: ChatMessage): MsgMap {
  const list = map[convId] ?? [];
  return {
    ...map,
    [convId]: list.map((existing) => existing.convSeq === m.convSeq
      ? {
          ...existing,
          serverMsgId: m.serverMsgId || existing.serverMsgId,
          fileName: m.fileName || existing.fileName,
          fileSize: m.fileSize !== undefined && m.fileSize > 0 ? m.fileSize : existing.fileSize,
          recalledAt: m.recalledAt || existing.recalledAt,
          recalledBy: m.recalledBy || existing.recalledBy,
          editedAt: m.editedAt || existing.editedAt,
          pinnedAt: m.pinnedAt || existing.pinnedAt,
        }
      : existing),
  };
}

/** 单会话内按 conv_seq 应用消息操作补丁（撤回/编辑/置顶；会话不存在 → 原样返回）。 */
export function applyOpBySeq(map: MsgMap, cid: string, seq: number, patch: Partial<ChatMessage>): MsgMap {
  const list = map[cid];
  if (!list) return map;
  return { ...map, [cid]: list.map((m) => (m.convSeq === seq ? { ...m, ...patch } : m)) };
}

/** 单会话内按 conv_seq 移除一条（无匹配 → **原样返回**同引用，省一次渲染）。 */
export function removeBySeq(map: MsgMap, cid: string, seq: number): MsgMap {
  const list = map[cid];
  if (!list) return map;
  const next = list.filter((m) => m.convSeq !== seq);
  return next.length === list.length ? map : { ...map, [cid]: next };
}

/** 单会话内按 clientMsgId 移除本地行（取消/重试/删除出箱件共用；会话不存在 → 原样返回）。 */
export function removeByClientMsgId(map: MsgMap, cid: string, key: string): MsgMap {
  const list = map[cid];
  if (!list) return map;
  return { ...map, [cid]: list.filter((x) => x.clientMsgId !== key) };
}
