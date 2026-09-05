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
  /** 本地已下载到的最大 conv_seq。`head` 超过它即证明下方还有没下载的消息——
   *  这条证据是 O(1) 的，且**不依赖 `hasGap` 这个连接级内存标志**（刷新/重连后它会短暂为空）。
   *
   *  **刻意必填**：给个默认值就等于让「没传」静默变成一种判断（默认 0 → 恒判有缺口，
   *  默认 ∞ → 这条证据恒不生效）。两种默认都会在调用方漏传时悄悄给出错误的数字，
   *  而本函数存在的全部理由就是不让 ↓N 悄悄算错。 */
  localNewest: number;
  /** 本地区间清单是否**完整覆盖** `(pendingRead, head]` —— 即"已滚入位点到服务端最新位点之间，
   *  服务端给过的每一个 conv_seq 本地都有"。调用方用 `coversSpan(rangesOf(conv), pendingRead+1, head)` 算。
   *
   *  为什么需要这条、而 head 与"本地最新一条"比不够（2026-09-05 实测）：
   *  `msg_op` 事件行、「为所有人删除」的墓碑、对我不可见的行**都会占掉一个 conv_seq 却永远不成为消息**。
   *  20000 人大群里最后一条恰是 `op=pin` 事件行（head=110031，最后一条真消息 110030），
   *  于是滚到底再往上滑，`head > localNewest` 恒成立、`head − pendingRead` 恒等于 1 ——
   *  ↓ 按钮永远挂着一条根本不存在的未读（iOS/Web 同现场，两端同一份判据）。
   *
   *  区间清单记的正是「服务端给过了」的范围，登记时**含**这些不渲染的行（见 imSdk 的 convRanges 注释
   *  与 iOS `handleWindowResp` 的 spanLo/spanHi），所以它才是这个问题的正确判据。
   *  覆盖住就说明**下面一件不缺**，`loadedBelow` 是精确值——此时连 `hasGap` 都不必看：
   *  缺口若存在也在已滚入位点**之上**，与"下面还有多少"无关。 */
  coveredBelowFrontier: boolean;
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
export function unreadBelowCount({ hasGap, head, pendingRead, loadedBelow, localNewest, coveredBelowFrontier }: UnreadBelowInput): number {
  // 先看**正面证据**：已滚入位点到 head 之间服务端给过的都在本地 → 下面一件不缺，数本地就是精确值。
  // 这条优先于下面两条"本地不全"的间接证据——它们都是拿 seq 连不连号在猜，而 conv_seq 里混着
  // msg_op 事件行/墓碑/对我不可见的行，猜出来会凭空多几条（见 coveredBelowFrontier 注释）。
  if (head > 0 && coveredBelowFrontier) return loadedBelow;
  // 两条独立的「本地不全」证据，任一成立都不能数本地：
  //   · hasGap —— 收到过 too_long（连接级内存标志，刷新/重连后会短暂丢失）；
  //   · head > localNewest —— 服务端最新位点超过本地最新一条，**O(1) 且不依赖上面那个标志**。
  // 只认第一条会漏掉一类现场：iOS 侧同款判据曾因此把 1 万条未读显示成 185（= 窗口条数），
  // 那时窗口「贴着本地最新」，看上去一切正常（2026-09-03 实测）。
  if ((hasGap || head > localNewest) && head > 0) {
    return head > pendingRead ? head - pendingRead : 0;
  }
  return loadedBelow;
}
