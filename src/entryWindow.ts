// 进会话取哪一窗（CHAT_UX §3）。
//
// 抽成纯函数 + 单测的理由与 convQuerySource / unreadBelow 一样：**它错了不会报错**，
// 只是首屏停在了不该停的地方。2026-09-03 就栽过一次——判据写成 `latestSeq > readSeq`，
// 对**发送方**必然成立（服务端未读计数排除本人消息，见 CountUnreadSince 的 `sender <> ?`，
// 所以自己刚发的一万条不会推进自己的读位点）。于是压测灌完后本人进会话被锚到一万条之前：
// 不贴底、↓N 显示一大串，看着像"消息没发出去"。

export interface EntryWindowInput {
  /** 本人在该会话的已读位点。 */
  readSeq: number;
  /** 会话最新 conv_seq（服务端权威）。 */
  latestSeq: number;
  /** **真实未读数**（服务端算，已排除本人消息与系统/事件行）。判据只认它。 */
  unread: number;
  /** 未读分割线上方保留的已读上下文条数。 */
  contextBefore: number;
  /** 单页条数。 */
  historyPage: number;
}

/**
 * 首屏该从哪个位点起拉一页（sync_req 的 since_conv_seq）。
 *
 * 有未读 → 锚到首条未读附近（往上多带一点上下文，让分割线不贴着屏幕顶）；
 * 无未读 → 最近一页，进会话即贴底。
 */
export function entryWindowSince({ readSeq, latestSeq, unread, contextBefore, historyPage }: EntryWindowInput): number {
  // readSeq<=0 是「一条都没读过」（首次登录、刚入群），**不是"没有可锚的位点"**——
  // 位点就是 0，首条未读即会话里对我可见的第一条。早先这里加了 `&& readSeq > 0`，
  // 于是首次登录的新成员被判成"无未读"直接取最近一页：进 2 万人大群停在最新，
  // 分割线摆在倒数第 200 条上方，紧接着「可见即读」把 read_seq 一路推到 109820——
  // **十万条未读进一次会话就清零**（2026-09-03 user13028 实测，服务端 read_position 实锤）。
  // since=0 时服务端会从可见下界（G2 入群位点）起给第一页，故新成员也拿得对。
  if (unread > 0) return Math.max(0, readSeq - contextBefore);
  return Math.max(0, latestSeq - historyPage);
}
