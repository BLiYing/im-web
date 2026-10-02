// delivered 回执合批（OFFLINE_BACKLOG_DESIGN §4.8），从 imSdk.ts 拆出（体量棘轮）。
//
// 回执是**单调位点**，合批零语义损失：短窗口内每个会话只留最大位点、只发一帧。
// 逐条发在补拉 10 万条时就是 10 万个上行帧，且服务端每帧要做一次群快照 + 成员鉴权。

export class ReceiptBatcher {
  private pending = new Map<string, number>();   // convId -> 待上报的最大 conv_seq
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** @param emit 真正发一帧 delivered 回执（每会话一次，位点取最大）。@param windowMs 合批窗口。 */
  constructor(private readonly emit: (convId: string, upTo: number) => void, private readonly windowMs = 120) {}

  /** 排队一个 delivered 回执（只留最大值），短窗口内合并成一帧。 */
  push(convId: string, upTo: number): void {
    if (!convId || upTo <= 0) return;
    if (upTo > (this.pending.get(convId) ?? 0)) this.pending.set(convId, upTo);
    if (this.timer !== null) return;
    this.timer = setTimeout(() => this.flush(), this.windowMs);
  }

  /** 把排队的回执各发一帧。 */
  flush(): void {
    this.clearTimer();
    for (const [convId, upTo] of this.pending) this.emit(convId, upTo);
    this.pending.clear();
  }

  /** 丢弃未发的回执（切账号 / 退出：旧账号的回执不许发给新账号）。 */
  clear(): void {
    this.clearTimer();
    this.pending.clear();
  }

  private clearTimer(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }
}
