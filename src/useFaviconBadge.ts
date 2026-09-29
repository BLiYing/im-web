// 标签页未读角标接线（NOTIFICATIONS_P1_DESIGN.md §3）：把「会话列表 → badgeCountOf」接到
// faviconBadge.ts 的 canvas 绘制 + document.title 前缀。**仅浏览器版生效**——桌面客户端
// （Electron）已有 Dock/任务栏角标（`platform().setBadge`，见 useDesktopIntegration.ts），
// 这里显式挡一道，不重复画。App.tsx 必须在登录早退之前调用本 hook（Hooks 规则）。
import { useEffect, useRef } from "react";
import { platform } from "./platform";
import { badgeCountOf } from "./desktopNotify";
import { faviconBadgeState, faviconBadgeKey, faviconTitleOf, hasMarkedUnreadConv, drawFaviconBadge } from "./faviconBadge";
import type { Conversation } from "./sdk/protocol";

/** @param includeMuted 通知设置 §3.4「包含免打扰会话」，与底部「消息」页签、Dock 角标同一个开关。 */
export function useFaviconBadge(conversations: readonly Conversation[], includeMuted: boolean): void {
  // 只捕获一次原始标题：如果每次渲染都从 `document.title` 现读，会把上一次自己写回去的
  // "(3) " 前缀当成新的 base 再叠一层，越叠越长。
  const baseTitleRef = useRef<string | null>(null);
  if (baseTitleRef.current === null) baseTitleRef.current = document.title;

  const count = badgeCountOf(conversations, includeMuted);
  const state = faviconBadgeState(count, hasMarkedUnreadConv(conversations));
  const key = faviconBadgeKey(state);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (platform().isDesktop) return; // 桌面版已有 Dock/任务栏角标，不重复画 favicon（§3 明文）
    if (lastKey.current === key) return; // 数字不变不重画：会话列表一秒可能刷新很多次
    lastKey.current = key;
    drawFaviconBadge(state);
    document.title = faviconTitleOf(state, baseTitleRef.current!);
    // 依赖只写 key（string 原语，仿 useDesktopIntegration.ts 的 badge 角标同款写法）：
    // state 每次渲染都是新对象，写进依赖数组会让 React 每次渲染都判定"变了"而重跑 effect，
    // 数字没变也照样重画——真正的节流靠依赖数组本身（key 不变不重跑）+ lastKey 兜底。
  }, [key]);
}
