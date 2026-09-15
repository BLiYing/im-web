// 左栏顶部两个页签：消息 / 通讯录。
//
// 「消息」页签上的蓝点：有未读就亮，口径与 Dock 角标同一份 `badgeCountOf`（免打扰不计、免打扰里 @我 计 1），
// 与 iOS 底栏「消息」Tab 的 `IMTabUnreadCount`、Android 底栏的 `TabUnread` 同一判据（IMServer docs/SYMMETRY.md 已登记）。
// 此前只有 Android 有这颗点，Web 与 iOS 都没画（2026-09-15 用户报）；页签文案同日由「会话」改「消息」，三端一致。
import type { Conversation } from "../sdk/protocol";
import { badgeCountOf } from "../desktopNotify";
import { unreadBadgeText } from "../unreadBadge";

export type SidebarTab = "chats" | "contacts";

export interface SidebarTabsProps {
  tab: SidebarTab;
  conversations: readonly Conversation[];
  /** 待处理的好友申请数（「通讯录」页签的数字角标）。 */
  incomingCount: number;
  onChats: () => void;
  onContacts: () => void;
}

export function SidebarTabs({ tab, conversations, incomingCount, onChats, onContacts }: SidebarTabsProps) {
  const hasUnread = badgeCountOf(conversations) > 0;
  return (
    <div className="tabs">
      <button className={`tab ${tab === "chats" ? "active" : ""}`} onClick={onChats}>
        消息{hasUnread && <span className="tab-dot" role="status" aria-label="有未读消息" />}
      </button>
      <button className={`tab ${tab === "contacts" ? "active" : ""}`} onClick={onContacts}>
        通讯录{incomingCount > 0 && <span className="tab-badge">{unreadBadgeText(incomingCount)}</span>}
      </button>
    </div>
  );
}
