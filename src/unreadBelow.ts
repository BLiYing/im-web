// ↓N 徽标的取数判据（IMServer/docs/design/OFFLINE_BACKLOG_DESIGN.md §4.9 第 8 项）。
//
// 抽成纯函数是因为这里错得**很安静**：数出来的 195 看着就是个正常数字，
// 没有报错、没有空白、界面一切正常，只是它本该是 10000。这种错必须靠断言钉住，
// 靠肉眼看一眼"嗯有个数字"是发现不了的。

export interface UnreadBelowInput {
  /** 本地对该会话有缺口（收到过 too_long）——即"缺口里的消息根本没下载"。 */
  hasGap: boolean;
  /** 服务端会话最新位点（sync_resp.head_conv_seq / conv_bump.latest_seq）；未知为 0。 */
  head: number;
  /** 已滚入（看过）的位点。 */
  pendingRead: number;
  /** 当前**已渲染**的消息里，位于已滚入位点之下的对端消息数。 */
  loadedBelow: number;
}

/**
 * 算 ↓N。
 *
 * 本地齐全 → 数已渲染的（准确，且与屏幕上看到的一致）。
 * 有缺口   → 用 `head − pendingRead`：数本地必然偏小，因为缺口里的消息压根没下载。
 *
 * 后者会把本人消息与系统消息也算进去，是刻意的取舍——缺口场景下积压成千上万，
 * 这点偏差无意义；而"一万条未读显示成 ↓195"会让人以为消息丢了。
 *
 * head 未知（=0，老服务端或还没收到过带 head 的响应）时退回数本地：宁可偏小，
 * 也不能拿一个没有依据的数字糊弄。
 */
export function unreadBelowCount({ hasGap, head, pendingRead, loadedBelow }: UnreadBelowInput): number {
  if (hasGap && head > 0) {
    return head > pendingRead ? head - pendingRead : 0;
  }
  return loadedBelow;
}
