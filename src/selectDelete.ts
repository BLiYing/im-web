import type { ChatMessage, GroupRole } from "./sdk/protocol";

// 多选批量删除的判据与执行（纯逻辑，见 selectDelete.test.ts）。
//
// 两档口径与单条删除（App 的 requestDelete / canDeleteForEveryone）**必须同源**：
//  - 「仅为我删除」= 批量 POST /messages/hide（落服务端 per-user 隐藏表 + 同步本人其它设备），任何已落库消息都可以；
//  - 「为所有人删除」= 批量 POST /messages/delete，权限与服务端 msgOpActor 一致：我发的，或我是该群群主/管理员。
// 两档都是**一次请求**、服务端逐条回成败（PROTOCOL §6.7.1 / §6.7.2），失败条数直接从 results 数。
// 批量只在**所选全部**满足时才给第二档——混选了别人的消息就只剩第一档，不做"能删几条删几条"：
// 那样用户点的是「为所有人删除」，却有一部分只是没删掉，结果要靠数气泡才知道。

export interface BatchDeletePlan {
  /** 真正要删的 conv_seq（升序；已剔除本地未落库的 ≤0）。 */
  seqs: number[];
  /** 所选是否全部可「为所有人删除」。 */
  canEveryone: boolean;
}

export function planBatchDelete(
  msgs: Pick<ChatMessage, "convSeq" | "from">[], selected: ReadonlySet<number>, uid: string, myRole?: GroupRole,
): BatchDeletePlan {
  const seqs = [...selected].filter((s) => s > 0).sort((a, b) => a - b);
  if (seqs.length === 0) return { seqs, canEveryone: false };
  if (myRole === "owner" || myRole === "admin") return { seqs, canEveryone: true };
  // 发送者按内存里的消息反查；查不到的（窗口滑走了）一律按"不是我发的"算——宁可少给一档，不误放行。
  const senderBySeq = new Map<number, string>();
  for (const m of msgs) if (m.convSeq > 0) senderBySeq.set(m.convSeq, m.from);
  return { seqs, canEveryone: seqs.every((s) => senderBySeq.get(s) === uid) };
}

/** 服务端批量删除 / 隐藏的单条结果（PROTOCOL §6.7.1 / §6.7.2 的 results[] 元素）。 */
export interface BatchItemResult { conv_seq: number; ok: boolean; code?: number }

/**
 * 把服务端 results 对回请求的 seqs：成功的 seq（供本地移除）+ 失败条数（供「N 条删除失败」）。
 * results 缺项 / 缺字段一律算失败——宁可多报一条失败，也不把没删掉的当删掉了。
 */
export function summarizeBatch(seqs: number[], results: unknown): { okSeqs: number[]; failed: number } {
  const ok = new Set<number>();
  if (Array.isArray(results)) {
    for (const r of results as Partial<BatchItemResult>[]) if (r && r.ok === true && typeof r.conv_seq === "number") ok.add(r.conv_seq);
  }
  const okSeqs = seqs.filter((s) => ok.has(s));
  return { okSeqs, failed: seqs.length - okSeqs.length };
}

/** msg_hidden 帧里要移除的 seq：批量帧优先读 conv_seqs，单条帧（老服务端 / 单条隐藏）退回 conv_seq。 */
export function hiddenSeqsOf(d: { conv_seq?: unknown; conv_seqs?: unknown }): number[] {
  if (Array.isArray(d.conv_seqs)) return d.conv_seqs.map(Number).filter((s) => s > 0);
  const one = Number(d.conv_seq);
  return one > 0 ? [one] : [];
}

/**
 * 批量「为所有人删除」的实时广播帧（PROTOCOL §6.7.2）：一次批量只来一帧 msg_op{op:delete, targets:[…]}。
 * 返回要移除的消息 seq 与各自事件行的 op_conv_seq（后者要登记进区间清单，否则是清单里的洞）。
 * 不是批量帧（没有 targets）返回 null，按单条 msg_op 处理。
 */
export function batchDeleteTargetsOf(d: { op?: unknown; targets?: unknown; [k: string]: unknown }): { seqs: number[]; opSeqs: number[] } | null {
  if (d.op !== "delete" || !Array.isArray(d.targets)) return null;
  const seqs: number[] = [], opSeqs: number[] = [];
  for (const it of d.targets as Array<{ target_conv_seq?: unknown; op_conv_seq?: unknown }>) {
    const s = Number(it?.target_conv_seq), o = Number(it?.op_conv_seq);
    if (s > 0) seqs.push(s);
    if (o > 0) opSeqs.push(o);
  }
  return { seqs, opSeqs };
}

