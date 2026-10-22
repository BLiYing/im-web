// 批量物理移除的本地侧（批量删除 REST 成功项 / 批量删除广播帧 / msg_hidden 批量帧共用）。
// 从 imSdk.ts 拆出（该文件已超体量预算，CODING_STYLE §7）。

import * as localStore from "./localStore";
import { batchDeleteTargetsOf } from "../selectDelete";
import { batchUnpinTargetsOf } from "./pinnedApi";

/** 整批墓碑**一个事务**落库（localStore.markMessagesDeleted），随后**只通知一次**（带全部 seq），
 *  UI 侧一批只做一次 setState / 置顶重拉 / 列表刷新，而不是逐条触发。 */
export async function removeBatchLocal(
  uid: string, convId: string, seqs: number[], onRemoved: (convId: string, seqs: number[]) => void,
): Promise<void> {
  if (seqs.length === 0) return;
  await localStore.markMessagesDeleted(uid, convId, seqs);
  onRemoved(convId, seqs);
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

/** 批量「取消置顶」广播帧（一键取消所有置顶，PROTOCOL §6.7.2 / §11 `/pinned/clear`）：逐个目标按单条 pin(pinned=false)
 *  应用（落库 + onMsgOp），各 op_conv_seq 同样登记。是该帧返回 true；否则 false，调用方按单条 msg_op 处理。 */
export function applyBatchUnpinFrame(
  d: { op?: unknown; pinned?: unknown; conv_id?: unknown; targets?: unknown },
  unpin: (convId: string, seq: number) => void,
  register: (convId: string, opSeq: number) => void,
): boolean {
  const batch = batchUnpinTargetsOf(d);
  if (!batch || !d.conv_id) return false;
  batch.seqs.forEach((s) => unpin(String(d.conv_id), s));
  batch.opSeqs.forEach((o) => register(String(d.conv_id), o));
  return true;
}
