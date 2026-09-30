import type { ChatMessage, GroupRole } from "./sdk/protocol";

// 多选批量删除的判据与执行（纯逻辑，见 selectDelete.test.ts）。
//
// 两档口径与单条删除（App 的 requestDelete / canDeleteForEveryone）**必须同源**：
//  - 「仅为我删除」= 逐条走 hide（落服务端 per-user 隐藏表 + 同步本人其它设备），任何已落库消息都可以；
//  - 「为所有人删除」= 逐条发 msg_op delete，权限与服务端 handleMsgOp 一致：我发的，或我是该群群主/管理员。
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

/** 有限并发地对每个 seq 跑一次 worker，返回**失败条数**。单条失败不打断其余（删成几条算几条，失败数交给调用方提示）。 */
export async function runBatch(seqs: number[], worker: (seq: number) => Promise<void>, concurrency = 4): Promise<number> {
  let next = 0;
  let failed = 0;
  const lane = async () => {
    while (next < seqs.length) {
      const seq = seqs[next++];
      try { await worker(seq); } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), seqs.length) }, lane));
  return failed;
}
