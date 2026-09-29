// 左栏顶部两个页签：消息 / 通讯录。
//
// 「消息」页签上的蓝点：有未读就亮，口径与 Dock 角标同一份 `badgeCountOf`（免打扰不计、免打扰里 @我 计 1），
// 与 iOS 底栏「消息」Tab 的 `IMTabUnreadCount`、Android 底栏的 `TabUnread` 同一判据（IMServer docs/SYMMETRY.md 已登记）。
// 此前只有 Android 有这颗点，Web 与 iOS 都没画（2026-09-15 用户报）；页签文案同日由「会话」改「消息」，三端一致。
import type { Conversation } from "../sdk/protocol";
import { badgeCountOf } from "../desktopNotify";
import { unreadBadgeText } from "../unreadBadge";
import { useT } from "../i18n";

export type SidebarTab = "chats" | "contacts";

export interface SidebarTabsProps {
  tab: SidebarTab;
  conversations: readonly Conversation[];
  /** 待处理的好友申请数（「通讯录」页签的数字角标）。 */
  incomingCount: number;
  /** 通知设置 ▸ 角标计数 ▸「包含免打扰会话」（NOTIFICATIONS_DESIGN §3.4）；默认 false=现行口径。 */
  includeMuted?: boolean;
  onChats: () => void;
  onContacts: () => void;
}

export function SidebarTabs({ tab, conversations, incomingCount, includeMuted = false, onChats, onContacts }: SidebarTabsProps) {
  const tr = useT();
  const hasUnread = badgeCountOf(conversations, includeMuted) > 0;
  return (
    <div className="tabs">
      <button className={`tab ${tab === "chats" ? "active" : ""}`} onClick={onChats}>
        {tr("sidebar.tab.chats")}{hasUnread && <span className="tab-dot" role="status" aria-label={tr("sidebar.tab.unread_aria")} />}
      </button>
      <button className={`tab ${tab === "contacts" ? "active" : ""}`} onClick={onContacts}>
        {tr("contacts.title")}{incomingCount > 0 && <span className="tab-badge">{unreadBadgeText(incomingCount)}</span>}
      </button>
    </div>
  );
}
