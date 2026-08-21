// ChatHeader：聊天列标题栏——搜索态下换成 ChatSearchBar；否则 返回钮 + 身份区（头像/标题/副标题）+ 右侧 搜索/呼叫/⋯ 菜单
// （群：群资料/邀请成员/免打扰/选择消息/退出群聊；单聊：编辑联系人/视频通话/免打扰/选择消息/拉黑/删除会话）。
// 阶段 9 从 App.tsx 平移的纯展示组件（JSX 逐字一致；菜单动作打包为 actions 注入，search 为 useChatSearch 返回整体透传，
// comingSoon 取自 AppServicesContext）。
import type { Dispatch, SetStateAction } from "react";
import { Search, Phone, MoreVertical, Info, UserPlus, BellOff, CheckSquare, LogOut, SquarePen, Video, Ban, Trash2 } from "lucide-react";
import type { Conversation, GroupInfo } from "../sdk/protocol";
import type { useChatSearch } from "../useChatSearch";
import { useAppServices } from "../AppServicesContext";
import { Avatar } from "./Avatar";
import { ChatSearchBar } from "./ChatSearchBar";

export interface ChatHeaderActions {
  deselect: () => void;
  openGroupPanel: (cid: string) => void;
  openPeerDetail: (peer: string, fromOwnChat?: boolean) => void;
  setInviteDraft: (v: { convId: string; selected: string[] }) => void;
  setConvMuted: (c: Conversation, muted: boolean) => void;
  enterSelectMode: () => void;
  doLeaveGroup: (cid: string) => Promise<void>;
  setContactDraft: (v: { peer: string; remark: string }) => void;
  doToggleBlock: (peer: string, block: boolean) => void;
  deleteConv: (c: Conversation) => void;
}
export interface ChatHeaderProps {
  searchOpen: boolean;
  isGroupChat: boolean;
  peer: string;
  groupConvId: string;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  search: ReturnType<typeof useChatSearch>;
  chatTitle: string;
  chatAvatarURL: string | undefined;
  visibleChatSubtitle: string;
  chatMenu: boolean;
  setChatMenu: Dispatch<SetStateAction<boolean>>;
  groupInfos: Record<string, GroupInfo>;
  groupConv: Conversation | undefined;
  peerConv: Conversation | undefined;
  peerBlocked: boolean;
  actions: ChatHeaderActions;
}

export function ChatHeader(p: ChatHeaderProps) {
  const { searchOpen, isGroupChat, peer, groupConvId, searchQuery, setSearchQuery, search, chatTitle, chatAvatarURL, visibleChatSubtitle,
    chatMenu, setChatMenu, groupInfos, groupConv, peerConv, peerBlocked, actions } = p;
  const { comingSoon } = useAppServices();
  return (
    <header>
      {/* 会话内搜索（§4）：搜索态下搜索条**替换标题栏内容**（对齐 iOS）；下拉/日历锚标题栏下方；非搜索态=原头部。 */}
      {searchOpen && (isGroupChat || peer) ? (
        <ChatSearchBar
          searchInputRef={search.searchInputRef} isGroupChat={isGroupChat}
          searchQuery={searchQuery} setSearchQuery={setSearchQuery} searchNeedle={search.searchNeedle}
          searchHitCount={search.searchHits.length} searchHitIdx={search.searchHitIdx}
          gotoSearchHit={search.gotoSearchHit} closeInChatSearch={search.closeInChatSearch}
          searchFrom={search.searchFrom} searchFromName={search.searchFromName} clearSearchFrom={search.clearSearchFrom}
          searchFromPickerOpen={search.searchFromPickerOpen} setSearchFromPickerOpen={search.setSearchFromPickerOpen}
          searchFromRows={search.searchFromRows} openFromPicker={search.openFromPicker} pickSearchFrom={search.pickSearchFrom}
          calendarOpen={search.calendarOpen} setCalendarOpen={search.setCalendarOpen}
          calendarMonth={search.calendarMonth} setCalendarMonth={search.setCalendarMonth} activeDays={search.activeDays}
          jumpToDay={search.jumpToDay} jumpToEarliest={search.jumpToEarliest} jumpToToday={search.jumpToToday} monthLabel={search.monthLabel}
        />
      ) : (
      <>
      {(peer || isGroupChat) && <button className="link back-btn" onClick={actions.deselect}>‹ 会话</button>}
      {(isGroupChat || peer) ? (
        <button className="chat-identity"
          title={isGroupChat ? "查看群资料" : "查看资料"}
          onClick={() => isGroupChat ? actions.openGroupPanel(groupConvId) : actions.openPeerDetail(peer, true)}>
          <Avatar url={chatAvatarURL} label={chatTitle} seed={groupConvId || peer} cls="chat-avatar" />
          <span className="chat-identity-copy">
            <span className="chat-title">{chatTitle}</span>
            <span className="chat-subtitle">{visibleChatSubtitle}</span>
          </span>
        </button>
      ) : (
        <span className="muted">未选择会话</span>
      )}
      <span className="chat-head-right">
        {(peer || isGroupChat) && (
          <>
            <button className={`icon-btn${searchOpen ? " active" : ""}`} title="搜索聊天内容" onClick={() => (searchOpen ? search.closeInChatSearch() : search.openInChatSearch())}><Search size={20} /></button>
            {!isGroupChat && <button className="icon-btn" title="呼叫" onClick={() => comingSoon("语音通话")}><Phone size={20} /></button>}
            <span className="chat-anchor">
              <button className="icon-btn" title="更多" onClick={(e) => { e.stopPropagation(); setChatMenu((v) => !v); }}><MoreVertical size={20} /></button>
            {chatMenu && (
              <div className="menu-card chat-menu" onClick={(e) => e.stopPropagation()}>
                {(isGroupChat ? [
                  { id: "info", label: "群资料", icon: Info, run: () => actions.openGroupPanel(groupConvId) },
                  // 「仅管理员可邀请」开启且我非管理员 → 隐藏邀请入口（对齐 iOS / 详情面板）。
                  ...(!groupInfos[groupConvId]?.perm_invite || groupInfos[groupConvId]?.my_role !== "member"
                    ? [{ id: "invite", label: "邀请成员", icon: UserPlus, run: () => actions.setInviteDraft({ convId: groupConvId, selected: [] }) }]
                    : []),
                  { id: "mute", label: groupConv?.muted ? "取消免打扰" : "免打扰", icon: BellOff, run: () => { if (groupConv) actions.setConvMuted(groupConv, !groupConv.muted); } },
                  { id: "select", label: "选择消息", icon: CheckSquare, run: () => actions.enterSelectMode() },
                  { id: "leave", label: "退出群聊", icon: LogOut, danger: true, run: () => void actions.doLeaveGroup(groupConvId) },
                ] : [
                  { id: "edit", label: "编辑联系人", icon: SquarePen, run: () => actions.setContactDraft({ peer, remark: peerConv?.peer_remark ?? "" }) },
                  { id: "call", label: "视频通话", icon: Video, run: () => comingSoon("视频通话") },
                  { id: "mute", label: peerConv?.muted ? "取消免打扰" : "免打扰", icon: BellOff, run: () => { if (peerConv) actions.setConvMuted(peerConv, !peerConv.muted); } },
                  { id: "select", label: "选择消息", icon: CheckSquare, run: () => actions.enterSelectMode() },
                  { id: "block", label: peerBlocked ? "取消拉黑" : "拉黑", icon: Ban, danger: !peerBlocked, run: () => actions.doToggleBlock(peer, !peerBlocked) },
                  { id: "del", label: "删除会话", icon: Trash2, danger: true, run: () => { if (peerConv) actions.deleteConv(peerConv); } },
                ]).map((r) => (
                  <button key={r.id} className={`menu-card-row${"danger" in r && r.danger ? " danger" : ""}`}
                    onClick={() => { setChatMenu(false); r.run(); }}>
                    <r.icon size={18} className="row-icon" /><span className="row-label">{r.label}</span>
                  </button>
                ))}
              </div>
            )}
            </span>
          </>
        )}
      </span>
      </>
      )}
    </header>
  );
}
