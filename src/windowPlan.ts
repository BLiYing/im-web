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
 * 位点就是会话对我可见的第一条。早先这里多判了一个 `readSeq > 0`，
 * 于是首次进 2 万人大群的新成员被当成"无未读"直接贴最新，紧接着「可见即读」把 read_seq
 * 一路推到头——**十万条未读进一次会话清零**（2026-09-03 user13028 实测）。
 *
 * ⚠️ **有未读时锚点最小是 1，不能是 0**：`window_req` 里 `anchor<=0` 是「取最新」这个哨兵
 * （`internal/gateway/window.go` 的 `if data.Anchor <= 0`），与 `sync_req` 的 `since=0`＝
 * 「从头开始」语义相反。照搬 `since` 那套写成 0，`readSeq=0` 的新成员拿回来的就是**最新
 * `contextBefore` 条**，「可见即读」跟着把 read_seq 推到头——正是上面那条事故的原样复现。
 * `anchor=1` 时服务端 `LoadBefore(1,…)` 为空 ⇒ `has_before=false`，`LoadSince(0,…)` 从可见
 * 下界给第一页，正好是"首条未读即对我可见的第一条"。
 */
export function entryWindowAnchor({ readSeq, unread, contextBefore, historyPage }: EntryWindowInput): {
  anchor: number; before: number; after: number;
} {
  if (unread > 0) return { anchor: Math.max(1, readSeq), before: contextBefore, after: historyPage };
  return { anchor: 0, before: historyPage, after: 0 }; // anchor=0 ⇒ 取最新
}

/**
 * 进会话：本地目录盖得住这一窗就不打网络（§4.6）。
 *
 * `head` 是服务端最新位点快照（0=未知）。**未知时一律问服务端**——
 * "取最新"这一窗的上界就是 head，不知道上界就无从判断本地齐不齐，
 * 此时若乐观地判成 local，用户进会话看到的就是一段停在旧位置的历史，而且不会有任何提示。
 */
export function planEntryWindow(
  input: EntryWindowInput & { ranges: SeqRange[]; head: number; localNewest: number },
): WindowPlan {
  const { anchor, before, after } = entryWindowAnchor(input);
  const tip = input.head > 0 ? input.head : input.latestSeq;
  const server: WindowPlan = { source: "server", anchor, before, after };
  if (tip <= 0) return server;                       // 连"最新到哪"都不知道 → 问服务端
  // 取最新（anchor=0）拿回的是**以 tip 结尾的 before 条**：`[tip-before+1, tip]`（IMServer `internal/gateway/window.go`
  // 的 `got[len(got)-before:]`）。按 `tip-before` 算会多要一条——刚取回最新一页后，这一窗永远判不齐，
  // 于是每次点 ↓、每次进无未读的会话都白问服务端一次（2026-09-11 C4 的出站帧测试抓到）。
  // 锚点开窗（anchor>0）是「前 before 条 + 锚点本身 + 后 after 条」，下沿就是 anchor-before。
  const lo = Math.max(1, anchor > 0 ? anchor - before : tip - before + 1);
  const hi = anchor > 0 ? Math.min(tip, anchor + after) : tip;
  if (hi < lo) return server;
  // **清单说齐全还不够，手里得真有东西**（/code-review 2026-09-09）。
  // 清单与消息表是两处存储，任何一处让它们失配，判 local 的后果就是**空白且不自愈**：
  // 一个请求都不发，上滑与点 ↓ 都走同一条判定。已知的失配来源是「清空聊天记录」只删了消息
  // （web 与 SQLite 两侧都已改成同事务连清单一起清），但**老库里已经孤立的清单追不回来**，
  // 所以这道闸得长期留着。代价只是偶尔多问一次服务端——往这个方向倒才是对的。
  if (input.localNewest < lo) return server;
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
export function moreLocalAbove(ranges: SeqRange[], oldestRendered: number, prevLocalSeq: number): boolean {
  if (oldestRendered <= 1) return false;
  // `prevLocalSeq` = 本地**实际存在的消息**里、比上沿更早的那个最大 conv_seq（没有则 0）。
  // 判据必须是「同一段内确实还有一条消息」，两个条件缺一不可：
  //   · 只看清单 → 清单可以合法地覆盖一段没有任何消息的号（整段都是 msg_op 事件行 / 墓碑），
  //     展开分支展不出东西、滑窗分支把锚点定在原地，上滑**永远不动也永远不发请求**；
  //   · 只看"本地任意位置还有更早的" → 那一条可能在**缺口另一侧的旧岛**里，同样展不出来
  //     （/code-review 2026-09-09：第一版就是这么写的，闸放宽了一档）。
  if (prevLocalSeq <= 0 || prevLocalSeq >= oldestRendered) return false;
  const seg = rangeContaining(ranges, oldestRendered);
  if (!seg) return prevLocalSeq === oldestRendered - 1; // 清单不可用（老库/未预热）→ 退回 seq 连号
  return prevLocalSeq >= seg.lo;                        // 就在这一段里 → 本地展开
}

/**
 * `has_before=false` 时该把可见下界记在哪一条上。
 *
 * **必须记位点、不能记布尔**（/code-review 2026-09-09）：服务端的 `has_before` 是相对**本窗下沿**
 * 说的，不是相对整条会话（`internal/gateway/window.go` 的 `hasBefore = len(pre) > before`）。
 * 从搜索结果跳进一个旧岛、上滑到岛顶时它同样为 false——记成布尔就等于宣布"整条会话到顶了"，
 * 之后回到最新那一段再上滑会被永久静默屏蔽，中间那段缺口再也补不上。
 * 整窗都是占号行（msg_op / 墓碑）时退回 anchor：那同样断言了"anchor 之下没有"，
 * 且 anchor 正是请求方当时的上沿，比得上、能收敛。
 *
 * ⚠️ **`seqs` 必须是「客户端真正会留下的行」的 conv_seq，不能是整窗 `d.messages` 的**
 * （2026-09-10 /code-review，两端同一个洞）。窗里混着 msg_op 事件行与「为所有人删除」的墓碑，
 * 它们**占号但被 `processIncoming` 当场丢掉**（iOS 侧同理）。拿整窗最小 seq 当下界，
 * 下界就落在一条**页面永远渲染不出来的号**上，而拿去比的 `oldestRendered` 只数真实消息 →
 * `atHistoryFloor` 恒假 → 每次滑到顶都再空问一次，**永不收敛**。
 * 具体：会话最早一条 seq=1 被「为所有人删除」、最早的真实消息是 seq=2 → 下界记成 1、
 * 上沿恒为 2，`2<=1` 永假。
 */
/**
 * 收到一次 `has_before=false` 之后，该会话的可见下界应当变成多少。
 *
 * **只往小里收**（对端是 iOS 的 `IMChatMergeHistoryFloor`）：往大里收会把已经证实存在的更早内容
 * 挡在外面，那是"少给用户看东西"的方向。`current` 未知（undefined/0）时取新值；新值算不出来（0）
 * 时保持原样。抽出来是因为这条合并规则两端都要有，而 Web 侧此前是内联的 `Math.min`——
 * 内联的东西不会被登记、也不会被单测钉住。
 */
export function nextHistoryFloor(current: number | undefined, keptSeqs: number[], anchor: number): number {
  const incoming = floorFromWindow(keptSeqs, anchor);
  if (incoming <= 0) return current && current > 0 ? current : 0;
  return current && current > 0 ? Math.min(current, incoming) : incoming;
}

export function floorFromWindow(keptSeqs: number[], anchor: number): number {
  const valid = keptSeqs.filter((n) => n > 0);
  return valid.length > 0 ? Math.min(...valid) : Math.max(0, anchor);
}

// ===== C4：↓ 跳到底 / 超级群 conv_bump 补不补（OFFLINE_BACKLOG_DESIGN §4.8）=====

export interface LatestWindowInput {
  ranges: SeqRange[];
  /** 服务端最新位点快照（0=未知）。 */
  head: number;
  /** 会话列表给的最新位点（head 未知时的退路）。 */
  latestSeq: number;
  /** 本地已下载的最大 conv_seq。 */
  localNewest: number;
  historyPage: number;
}

/**
 * ↓ 跳到底：**最后一页**本地齐不齐。齐 → 本地贴底、一个请求都不发；不齐 → `window_req(anchor=0)`。
 *
 * **不能只比「本地最大 seq < 最新」**（C4 之前 App 的判据）：离线积压超过 max_gap 后实时收到一条，
 * 那一条被登记成孤岛 `[seq, seq]`，本地最大 seq 已经等于最新——旧判据判「已是最新」，
 * 点 ↓ 只看到孤零零一条，它上面那一页永远不来。与进会话「无未读 → 取最新」是同一个问题，故直接复用那条判据。
 */
export function planJumpToLatest(input: LatestWindowInput): WindowPlan {
  return planEntryWindow({ ...input, readSeq: input.latestSeq, unread: 0, contextBefore: 0 });
}

export interface BumpCatchUpInput extends LatestWindowInput {
  /** 用户此刻是否贴底跟随（窗口含本地最新、且贴着底部）。 */
  following: boolean;
}

/**
 * 超级群 `conv_bump` 到了、会话正开着：该不该补、补哪一窗。
 *
 * 服务端对超级群在线只推信号不推全文，补不补全由客户端定：
 *   · **没贴底（在翻历史）→ 不补**。head 已由 SDK 更新，↓N 照常计数，点 ↓ 再取。
 *     C4 之前这里是「从本地最大 seq 往后拉一页」——用户停在旧岛上时拉回来的是缺口开头那一页，
 *     不是新消息，白跑一趟还把一段不相干的历史塞进本地；
 *   · 贴底跟随、差距 ≤ 一页 → 从尾段上沿接着取新的那几条（`anchor=尾段上沿, after=差距`），与尾段合并；
 *   · 贴底跟随、差距 > 一页 → 直接取最新一页（`anchor=0`），尾段与新页之间留成缺口——
 *     跟随的人要看的是最新，不是把几百条补齐（与连上时 max_gap 留缺口同一个取舍）。
 */
export function planBumpCatchUp(input: BumpCatchUpInput): WindowPlan {
  const tip = Math.max(input.head, input.latestSeq);
  if (!input.following || tip <= 0) return { source: "local" };
  if (coversSpan(input.ranges, tip, tip)) return { source: "local" };   // 最新那条本地已有
  const seg = rangeContaining(input.ranges, input.localNewest);
  const tailHi = seg ? seg.hi : input.localNewest;
  const gap = tip - tailHi;
  if (gap <= 0) return { source: "local" };
  if (tailHi > 0 && gap <= input.historyPage) return { source: "server", anchor: tailHi, before: 0, after: gap };
  return { source: "server", anchor: 0, before: input.historyPage, after: 0 };
}
