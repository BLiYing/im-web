import { useCallback, useRef, useState } from "react";
import { callRecordAcked, takeFailedCallRecord } from "./useCallRecordSend";
import type { ChatMessage } from "./sdk/protocol";
import {
  type MsgMap, appendTo, patchByClientMsgId, mapMatchingClientMsgId,
  mergeMetaBySeq, applyOpBySeq, removeBySeq, removeByClientMsgId,
} from "./messageStore";

// 会话消息表的有状态外壳：持有 msgsByConv 状态 + 两个去重/墓碑 ref，把 messageStore 的纯变换包成方法。
// 从 App.tsx 收口出来（去重/patch/append 那套逻辑原本散在 SDK handlers 里、难测）。纯逻辑在 messageStore.ts
// 单测，这里只做状态编排。**seenByConv/deletedByConv 仍以 ref 暴露**，供 App 里未完全收口的删除/预载路径直接读写。
export function useMessageStore() {
  const [msgsByConv, setMsgsByConv] = useState<MsgMap>({});
  // 去重集：已上屏的 conv_seq（防 sync/carbon 重复回显）。墓碑集：本端删过的 conv_seq（拦实时重推）。按会话隔离。
  const seenByConv = useRef<Record<string, Set<number>>>({});
  const deletedByConv = useRef<Record<string, Set<number>>>({});

  const appendMsg = useCallback((convId: string, m: ChatMessage) => setMsgsByConv((prev) => appendTo(prev, convId, m)), []);
  const patchMsg = useCallback((cid: string, clientMsgId: string, patch: Partial<ChatMessage>) => setMsgsByConv((prev) => patchByClientMsgId(prev, cid, clientMsgId, patch)), []);
  const removeMsgRow = useCallback((cid: string, key: string) => setMsgsByConv((prev) => removeByClientMsgId(prev, cid, key)), []);
  const applyOp = useCallback((cid: string, seq: number, patch: Partial<ChatMessage>) => setMsgsByConv((prev) => applyOpBySeq(prev, cid, seq, patch)), []);
  const removeSeq = useCallback((cid: string, seq: number) => setMsgsByConv((prev) => removeBySeq(prev, cid, seq)), []);
  const clearConv = useCallback((cid: string) => setMsgsByConv((prev) => ({ ...prev, [cid]: [] })), []);
  /** 预载本地历史：已在内存的会话（prev）优先，不被本地库覆盖。 */
  const preload = useCallback((loaded: MsgMap) => setMsgsByConv((prev) => ({ ...loaded, ...prev })), []);
  /** 退登/切号复位：清空消息与去重/墓碑集。App 的其余复位（会话列表/在线态…）另行处理。 */
  const reset = useCallback(() => { seenByConv.current = {}; deletedByConv.current = {}; setMsgsByConv({}); }, []);

  /**
   * 入站消息落库（onMessage）：先挡本端已删的重推，再按 conv_seq 去重——命中已见则把权威元数据合并进现有消息、
   * **不新增**；否则登记去重集并追加。返回是否**新追加**（调用方据此决定是否触发会话列表刷新——合并/丢弃不刷）。
   */
  const ingestInbound = useCallback((m: ChatMessage): boolean => {
    if (m.convSeq > 0 && deletedByConv.current[m.convId]?.has(m.convSeq)) return false; // 本端已删，丢弃
    const seen = (seenByConv.current[m.convId] ??= new Set());
    if (m.convSeq > 0) {
      if (seen.has(m.convSeq)) { setMsgsByConv((prev) => mergeMetaBySeq(prev, m.convId, m)); return false; }
      seen.add(m.convSeq);
    }
    setMsgsByConv((prev) => appendTo(prev, m.convId, m));
    return true;
  }, []);

  /** 发送回执（onAck）：跨所有会话按 clientMsgId 换 status/conv_seq/服务器时间戳；成功者把 conv_seq 记进去重集。 */
  /** 是在途的通话记录且失败了 → 抹掉本地行并返回 true（调用方不再走通用失败路径）。 */
  const dropFailedCallRecord = useCallback((clientMsgId: string, why: string): boolean => {
    const cid = takeFailedCallRecord(clientMsgId, why);
    if (cid === undefined) return false;
    setMsgsByConv((prev) => removeByClientMsgId(prev, cid, clientMsgId));
    return true;
  }, []);

  const applyAck = useCallback((clientMsgId: string, ok: boolean, convSeq: number, serverTs?: number) => {
    // 通话记录失败：吞掉（只写日志、抹掉本地行，不显红❗）——附带事实，不是用户「说的话」。
    if (ok) callRecordAcked(clientMsgId);
    else if (dropFailedCallRecord(clientMsgId, "ack_failed")) return;
    setMsgsByConv((prev) => mapMatchingClientMsgId(prev, clientMsgId, (m, cid) => {
      if (ok && convSeq > 0) (seenByConv.current[cid] ??= new Set()).add(convSeq);
      return { ...m, status: ok ? "sent" : "failed", convSeq, timestamp: ok && serverTs ? serverTs : m.timestamp };
    }));
  }, []);

  /** 消息被拒收（onMsgRejected，被拉黑）：跨所有会话按 clientMsgId 标失败 + 挂原因/码。 */
  const markRejected = useCallback((clientMsgId: string, note: string, code: number) => {
    if (dropFailedCallRecord(clientMsgId, `rejected_${code}`)) return; // 被拉黑（200102）等：同上，吞掉
    setMsgsByConv((prev) => mapMatchingClientMsgId(prev, clientMsgId, (m) => ({ ...m, status: "failed", note: note || undefined, noteCode: note ? code : undefined })));
  }, []);

  return {
    msgsByConv, setMsgsByConv, seenByConv, deletedByConv,
    appendMsg, patchMsg, removeMsgRow, applyOp, removeSeq, clearConv, preload, reset,
    ingestInbound, applyAck, markRejected,
  };
}
