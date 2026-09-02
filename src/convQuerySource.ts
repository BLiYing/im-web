// 「整会话问题」问谁：本地 / 服务端 / 本地但降级（docs/design/OFFLINE_BACKLOG_DESIGN.md §4.9）。
//
// 这是本方案里**唯一**需要三端口径完全一致的判断，所以抽成一个纯函数 + 单测钉死，
// 而不是在每个功能点各写一遍 if。写错的后果不是崩溃，是"答案悄悄不对"。
//
// 判据只有两个输入：本地这个会话齐不齐、现在能不能上网。

export type QuerySource =
  | "local"          // 本地齐全 → 本地（秒回、离线可用，与改造前完全一样）
  | "server"         // 有缺口 + 在线 → 服务端（权威、完整）
  | "local-degraded"; // 有缺口 + 离线 → 本地，但**必须告诉用户**只搜了已下载的部分

/**
 * @param complete 本地是否齐全（区间清单覆盖 floor+1..head，见 ranges.isComplete）
 * @param online   当前是否在线
 */
export function pickQuerySource(complete: boolean, online: boolean): QuerySource {
  if (complete) return "local";       // 齐全时联不联网都走本地——没有理由为一个完整的本地库去问服务端
  return online ? "server" : "local-degraded";
}

/** 降级提示文案（三端同源；iOS/Web 用同一句，避免同一处境两副说辞）。 */
export const DEGRADED_SEARCH_NOTICE = "离线：仅搜索已下载的消息";
export const DEGRADED_CALENDAR_NOTICE = "离线：仅显示已下载的消息";
export const NEED_NETWORK_NOTICE = "该消息尚未下载，需要联网加载";
