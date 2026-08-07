// 资料卡片「跟随会话切换」的纯决策逻辑。
// 从 App.tsx 的 effect 抽出，便于单元测试；只做判定，不触碰任何组件状态。
//
// 语义：资料卡片开着时，若当前会话（activeCid）已不是卡片对应的会话（detailConvId），
// 则把卡片切到当前会话对应的资料卡（群聊 / 单聊）。卡片没开、无当前会话、
// 或已是当前会话卡片时，均不动。

export type DetailFollowResult =
  | { action: "none" }
  | { action: "group"; convId: string }
  | { action: "peer" };

export interface DetailFollowParams {
  /** 资料卡片当前是否开着（App 里为 `!!detail`）。 */
  detailOpen: boolean;
  /** 卡片当前对应的会话 id（卡片未开时忽略）。 */
  detailConvId: string;
  /** 当前激活会话的 id；空串表示当前没有会话。 */
  activeCid: string;
  /** 当前会话是否群聊（App 里为 `!!groupConvId`）。 */
  isGroup: boolean;
}

/**
 * 决定资料卡片是否需要跟随当前会话切换，以及切成哪种卡片。
 * - 卡片没开 → none
 * - 没有当前会话（activeCid 为空）→ none（由 deselect 负责关闭卡片）
 * - 已是当前会话的卡片 → none
 * - 否则切换：群聊返回 group + 目标 convId；单聊返回 peer
 */
export function resolveDetailFollow(params: DetailFollowParams): DetailFollowResult {
  const { detailOpen, detailConvId, activeCid, isGroup } = params;
  if (!detailOpen) return { action: "none" };
  if (!activeCid || activeCid === detailConvId) return { action: "none" };
  return isGroup ? { action: "group", convId: activeCid } : { action: "peer" };
}
