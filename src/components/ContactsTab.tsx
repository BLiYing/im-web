// ContactsTab：左栏「通讯录」页签（找人搜索 + 扫一扫入口 + 入口行 + 搜索结果/新朋友/好友虚拟列表）。
// 阶段 7a 从 App.tsx 平移的纯展示组件（JSX 逐字一致；数据/动作经 props 注入，clientRef 取自 AppServicesContext）。
import type { RefObject } from "react";
import { QrCode } from "lucide-react";
import type { FriendEntry, UserCard } from "../sdk/protocol";
import { isOnline, type Presence } from "../sdk/presence";
import { useAppServices } from "../AppServicesContext";
import { Avatar } from "./Avatar";
import { VirtualList } from "../VirtualList";
import { renderRow, type Row } from "./rows";
import { useT } from "../i18n";

export interface ContactsTabProps {
  searchQ: string;
  setSearchQ: (v: string) => void;
  doSearch: () => Promise<void>;
  onScan: () => void;
  contactEntries: Row[];
  contactsScrollRef: RefObject<HTMLDivElement>;
  searchResults: UserCard[] | null;
  friendStatus: ReadonlyMap<string, string | undefined>;
  /** 显示名兜底（displayNameOf）：备注 > 昵称 > @句柄 > 占位。**username 要传**——
   *  不传的话，没设昵称的人主名直接落到「未命名用户」，而副行明明显示着 @句柄。 */
  labelOf: (id: string, nick: string, username?: string) => string;
  openFriendChat: (id: string) => void;
  busyUser: string | null;
  doFriendAction: (userId: string, fn: () => Promise<void>) => Promise<void>;
  accepted: FriendEntry[];
  filteredAccepted: FriendEntry[];
  contactFilter: string;
  setContactFilter: (v: string) => void;
  contactFilterQ: string;
  friendLabel: (f: FriendEntry) => string;
  presence: Record<string, Presence>;
  setFriendMenu: (v: { x: number; y: number; userId: string }) => void;
}

export function ContactsTab(p: ContactsTabProps) {
  const { searchQ, setSearchQ, doSearch, onScan, contactEntries, contactsScrollRef, searchResults, friendStatus, labelOf, openFriendChat,
    busyUser, doFriendAction, accepted, filteredAccepted, contactFilter, setContactFilter, contactFilterQ, friendLabel, presence, setFriendMenu } = p;
  const { clientRef, askFriendRequest } = useAppServices();
  const tr = useT();
  return (
    <div className="contacts">
      <div className="newchat">
        {/* 找人只认**完整 username / 手机号**（后端 SearchUsers 是等值匹配，防枚举）。
            原文案写「完整 uid」是双重错误：内部 ID 用户根本看不到（docs/UI.md 用户标识），
            真拿 uid 去搜也搜不到——SQL 里压根没有 user_id 这一路。 */}
        <input value={searchQ} placeholder={tr("contacts.search.placeholder")}
          onChange={(e) => setSearchQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }} />
        <button onClick={() => void doSearch()}>{tr("common.search")}</button>
        <button className="newchat-qr" title={tr("contacts.scan.title")} aria-label={tr("conv.menu.scan")} onClick={onScan}><QrCode size={18} /></button>
      </div>
      <div className="contact-entries">
        {contactEntries.map((r) => renderRow(r, "entry-row"))}
      </div>
      <div className="convlist" ref={contactsScrollRef}>
        {searchResults !== null && (
          <>
            <div className="section-label">{tr("contacts.search.results_title")}</div>
            {searchResults.length === 0 && <div className="empty">{tr("contacts.search.no_results")}</div>}
            {searchResults.map((u) => {
              const st = friendStatus.get(u.user_id);
              return (
                <div key={`s-${u.user_id}`} className="convitem static">
                  <Avatar url={u.avatar_url} label={labelOf(u.user_id, u.nickname, u.username)} seed={u.user_id} />
                  <div className="convbody">
                    <div className="convpeer">{labelOf(u.user_id, u.nickname, u.username)}</div>
                    {/* 副标题 = @句柄（+ 标签）。绝不显示 user_id——那是 10 位随机数字内部 ID
                        （docs/UI.md「用户标识」）。句柄缺失时只留标签。 */}
                    <div className="convlast">{[u.username ? `@${u.username}` : "", u.tags.join(" ")].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="row-actions">
                    {st === "accepted" ? (
                      <button className="mini-btn" onClick={() => openFriendChat(u.user_id)}>{tr("qr.action.send_message")}</button>
                    ) : st === "requested" ? (
                      <button className="mini-btn ghost" disabled>{tr("contacts.search.action_requested")}</button>
                    ) : st === "pending" ? (
                      <button className="mini-btn" disabled={busyUser === u.user_id}
                        onClick={() => void doFriendAction(u.user_id, () => clientRef.current!.friendAction("accept", u.user_id))}>{tr("common.agree")}</button>
                    ) : st === "blocked" ? (
                      <button className="mini-btn ghost" disabled>{tr("common.blocked")}</button>
                    ) : (
                      <button className="mini-btn" disabled={busyUser === u.user_id}
                        onClick={() => askFriendRequest(u.user_id, labelOf(u.user_id, u.nickname, u.username))}>{tr("contacts.search.action_add")}</button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* 「新的朋友」已移到顶部入口行（群聊下方）→ FriendRequestsModal（2026-09-05）。
            此处不再内联渲染：好友一多它就被挤到看不见，而"有人加我"恰恰要主动去处理。 */}

        <div className="section-label with-action friends-head">
          <span>{contactFilterQ ? tr("contacts.friends.header_filtered", { filtered: filteredAccepted.length, total: accepted.length }) : tr("contacts.friends.header_count", { count: accepted.length })}</span>
          {accepted.length > 0 && (
            <input className="contact-filter-input" value={contactFilter} placeholder={tr("friend.picker.search_placeholder")}
              onChange={(e) => setContactFilter(e.target.value)} />
          )}
        </div>
        {accepted.length === 0 && <div className="empty">{tr("contacts.friends.empty")}</div>}
        {accepted.length > 0 && filteredAccepted.length === 0 && <div className="empty">{tr("friend.picker.no_match")}</div>}
        {/* 好友列表虚拟化：只渲染视口内可见行，2000 好友首屏渲染从 ≈530ms 降到 <100ms
            （LOAD_TESTING 场景⑥）。共用 .convlist 滚动，上方搜索/新朋友/标签同处一个滚动条。 */}
        <VirtualList
          items={filteredAccepted}
          scrollElRef={contactsScrollRef}
          getKey={(f) => f.user_id}
          renderRow={(f) => (
            <div className="convitem" onClick={() => openFriendChat(f.user_id)}>
              <Avatar url={f.avatar_url} label={friendLabel(f)} seed={f.user_id}>
                {isOnline(presence[f.user_id]) && <span className="presence-dot" />}
              </Avatar>
              <div className="convbody">
                <div className="convpeer">{friendLabel(f)}{f.blocked && <span className="tag-blocked">{tr("common.blocked")}</span>}</div>
                {/* 同上：句柄而非内部 ID。没有句柄就留空行（不显示任何 ID）。 */}
                <div className="convlast">{f.username ? `@${f.username}` : ""}</div>
              </div>
              <div className="row-actions">
                <button className="mini-btn ghost" title={tr("common.more")}
                  onClick={(e) => { e.stopPropagation(); setFriendMenu({ x: e.clientX, y: e.clientY, userId: f.user_id }); }}>⋯</button>
              </div>
            </div>
          )}
        />
      </div>
    </div>
  );
}
