// 批量物理移除的本地侧（批量删除 REST 成功项 / 批量删除广播帧 / msg_hidden 批量帧共用）。
// 从 imSdk.ts 拆出（该文件已超体量预算，CODING_STYLE §7）。

import * as localStore from "./localStore";
import { batchDeleteTargetsOf } from "../selectDelete";

/** 先把墓碑全部落库，再在**同一个同步循环**里逐条通知 UI——React 把这一串 setState 合成一次渲染，
 *  而不是每条 await 一次、渲染一次。 */
export async function removeBatchLocal(
  uid: string, convId: string, seqs: number[], onRemoved: (convId: string, seq: number) => void,
): Promise<void> {
  if (seqs.length === 0) return;
  await Promise.all(seqs.map((s) => localStore.markMessageDeleted(uid, convId, { convSeq: s })));
  for (const s of seqs) onRemoved(convId, s);
}

/** 批量「为所有人删除」的实时广播帧（PROTOCOL §6.7.2）：一次只来一帧 targets——整批移除、整批登记事件行
 *  （op_conv_seq 不登记会是区间清单里的洞）。是批量帧返回 true；否则 false，调用方按单条 msg_op 处理。 */
export function applyBatchDeleteFrame(
  d: { op?: unknown; conv_id?: unknown; targets?: unknown },
  remove: (convId: string, seqs: number[]) => void,
  register: (convId: string, opSeq: number) => void,
): boolean {
  const batch = batchDeleteTargetsOf(d);
  if (!batch || !d.conv_id) return false;
  remove(String(d.conv_id), batch.seqs);
  batch.opSeqs.forEach((o) => register(String(d.conv_id), o));
  return true;
}
