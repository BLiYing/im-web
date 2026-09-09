// 取数分流：这一窗**问本地还是问服务端**（IMServer/docs/design/OFFLINE_BACKLOG_DESIGN.md §4.6/§4.7）。
//
// 本地库不再是"整本账的副本"，而是"看过的那几页 + 一张目录"。于是每次要显示一段消息之前，
// 都得先查那张目录（区间清单）：这一段本地齐全就直接开窗，缺了才向服务端要**那一屏**。
//
// 为什么抽成纯函数 + 单测（同 entryWindow / renderWindow / unreadBelow）：
// **判错了不会报错**。判成"本地有"而其实没有 → 用户看到的是一段静默残缺的历史；
// 判成"本地没有"而其实有 → 每次上滚都空跑一次网络请求，界面正常、只是白花往返。
// 前一种是无声的错，比后一种严重得多，所以下面所有拿不准的分支一律往"问服务端"倒。

import { coversSpan, rangeContaining, type SeqRange } from "./sdk/ranges";

/** 取数计划。`local` = 本地已齐全，一个请求都不发；`server` = 发 window_req 要这一屏。 */
export type WindowPlan =
  | { source: "local" }
  | { source: "server"; anchor: number; before: number; after: number };

export interface EntryWindowInput {
  /** 本人在该会话的已读位点。 */
  readSeq: number;
  /** 会话最新 conv_seq（服务端权威，来自会话列表快照）。 */
  latestSeq: number;
  /** **真实未读数**（服务端算，已排除本人消息与系统/事件行）。锚点判据只认它。 */
  unread: number;
  /** 未读分割线上方保留的已读上下文条数。 */
  contextBefore: number;
  /** 单页条数。 */
  historyPage: number;
}

/**
 * 进会话取哪一窗的**锚点**（CHAT_UX §3，取数来源变、规则不变）。
 *
 * 有未读 → 锚到已读位点（首条未读就在它下面一条），上方多带一点上下文让分割线不贴屏幕顶；
 * 无未读 → `anchor=0`，即 window_req 的"取最新"。
 *
 * **「有没有未读」必须看真实未读数，不能用 `latestSeq > readSeq` 顶替**（2026-09-03 实测）：
 * 服务端的未读计数排除本人消息（`CountUnreadSince` 的 `sender <> ?`），所以**发送方**的读位点
 * 天然落后于自己刚发的那一堆——压测灌完 1 万条后本人进会话，unread=0 而 latest 比 read_seq
 * 大一万，旧判据据此锚到一万条之前：不贴底、↓N 显示一大串，用户以为消息没发出去。
 *
 * `readSeq<=0` 是「一条都没读过」（首次登录、刚入群），**不是"没有可锚的位点"**——
 * 位点就是 0，首条未读即会话里对我可见的第一条。早先这里多判了一个 `readSeq > 0`，
 * 于是首次进 2 万人大群的新成员被当成"无未读"直接贴最新，紧接着「可见即读」把 read_seq
 * 一路推到头——**十万条未读进一次会话清零**（2026-09-03 user13028 实测）。
 */
export function entryWindowAnchor({ readSeq, unread, contextBefore, historyPage }: EntryWindowInput): {
  anchor: number; before: number; after: number;
} {
  if (unread > 0) return { anchor: Math.max(0, readSeq), before: contextBefore, after: historyPage };
  return { anchor: 0, before: historyPage, after: 0 }; // anchor=0 ⇒ 取最新
}

/**
 * 进会话：本地目录盖得住这一窗就不打网络（§4.6）。
 *
 * `head` 是服务端最新位点快照（0=未知）。**未知时一律问服务端**——
 * "取最新"这一窗的上界就是 head，不知道上界就无从判断本地齐不齐，
 * 此时若乐观地判成 local，用户进会话看到的就是一段停在旧位置的历史，而且不会有任何提示。
 */
export function planEntryWindow(input: EntryWindowInput & { ranges: SeqRange[]; head: number }): WindowPlan {
  const { anchor, before, after } = entryWindowAnchor(input);
  const tip = input.head > 0 ? input.head : input.latestSeq;
  const server: WindowPlan = { source: "server", anchor, before, after };
  if (tip <= 0) return server;                       // 连"最新到哪"都不知道 → 问服务端
  const lo = Math.max(1, (anchor > 0 ? anchor : tip) - before);
  const hi = anchor > 0 ? Math.min(tip, anchor + after) : tip;
  if (hi < lo) return server;
  return coversSpan(input.ranges, lo, hi) ? { source: "local" } : server;
}

/**
 * 上滚：当前渲染的最早一条**之上**还有没有本地已下载的内容（§4.7）。
 *
 * 判据是**区间清单**，不是 seq 连不连号。`oldestRendered - 1` 很可能是个占了 conv_seq
 * 却永远不成为消息的行（msg_op 事件行 / 已被「为所有人删除」的墓碑 / 对我不可见的行），
 * 按连号判会把"本地明明还有更早的"判成"到边界了"，于是空跑一次网络请求，
 * 并提前把渲染窗口切到锚点模式（窗口会抖）。这与 renderWindow.ts 的切段判据同源——
 * 两处判据必须一致，否则一边认为连着、另一边认为断了。
 *
 * `hasPrevSeqLocally` 是**清单不可用时**的退路（老库、清单还没预热好）：退回 seq 连号判定。
 * 宁可多问服务端一次，也不能把缺口两侧静默拼在一起。
 */
export function moreLocalAbove(
  ranges: SeqRange[],
  oldestRendered: number,
  local: { hasPrevSeq: boolean; hasAnyEarlier: boolean },
): boolean {
  if (oldestRendered <= 1) return false;
  // 清单说"还没到头"但内存里**确实一条更早的都没有** → 仍旧问服务端。
  // 少了这一条就有一条**无声的卡死路径**：展开分支什么也展不开（没内容）、滑窗分支把锚点
  // 定在原地（上沿不动），于是上滑永远不发请求也永远不动。清单记的是"下载过哪些号"，
  // 它可以合法地覆盖一段没有任何消息的号（整段都是 msg_op 事件行 / 墓碑）。
  if (!local.hasAnyEarlier) return false;
  const seg = rangeContaining(ranges, oldestRendered);
  if (!seg) return local.hasPrevSeq;
  return seg.lo < oldestRendered; // 同一段内还有更早的 → 本地展开；段首 → 上面是缺口或到顶
}

/** 下滚：当前渲染的最新一条**之下**还有没有本地已下载的内容（与 moreLocalAbove 对称）。 */
export function moreLocalBelow(ranges: SeqRange[], newestRendered: number, hasNextSeqLocally: boolean): boolean {
  if (newestRendered <= 0) return false;
  const seg = rangeContaining(ranges, newestRendered);
  if (!seg) return hasNextSeqLocally;
  return seg.hi > newestRendered;
}
