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

export interface ContactsTabProps {
  searchQ: string;
  setSearchQ: (v: string) => void;
  doSearch: () => Promise<void>;
  onScan: () => void;
  contactEntries: Row[];
  contactsScrollRef: RefObject<HTMLDivElement>;
  searchResults: UserCard[] | null;
  friendStatus: ReadonlyMap<string, string | undefined>;
  labelOf: (id: string, nick: string) => string;
  openFriendChat: (id: string) => void;
  busyUser: string | null;
  doFriendAction: (userId: string, fn: () => Promise<void>) => Promise<void>;
  incoming: FriendEntry[];
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
    busyUser, doFriendAction, incoming, accepted, filteredAccepted, contactFilter, setContactFilter, contactFilterQ, friendLabel, presence, setFriendMenu } = p;
  const { clientRef } = useAppServices();
  return (
    <div className="contacts">
      <div className="newchat">
        <input value={searchQ} placeholder="对方完整 uid 或手机号"
          onChange={(e) => setSearchQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }} />
        <button onClick={() => void doSearch()}>搜索</button>
        <button className="newchat-qr" title="扫一扫 / 我的二维码" aria-label="扫一扫" onClick={onScan}><QrCode size={18} /></button>
      </div>
      <div className="contact-entries">
        {contactEntries.map((r) => renderRow(r, "entry-row"))}
      </div>
      <div className="convlist" ref={contactsScrollRef}>
        {searchResults !== null && (
          <>
            <div className="section-label">搜索结果</div>
            {searchResults.length === 0 && <div className="empty">没有找到匹配的用户</div>}
            {searchResults.map((u) => {
              const st = friendStatus.get(u.user_id);
              return (
                <div key={`s-${u.user_id}`} className="convitem static">
                  <Avatar url={u.avatar_url} label={labelOf(u.user_id, u.nickname)} seed={u.user_id} />
                  <div className="convbody">
                    <div className="convpeer">{labelOf(u.user_id, u.nickname)}</div>
                    <div className="convlast">{u.user_id}{u.tags.length > 0 ? ` · ${u.tags.join(" ")}` : ""}</div>
                  </div>
                  <div className="row-actions">
                    {st === "accepted" ? (
                      <button className="mini-btn" onClick={() => openFriendChat(u.user_id)}>发消息</button>
                    ) : st === "requested" ? (
                      <button className="mini-btn ghost" disabled>已申请</button>
                    ) : st === "pending" ? (
                      <button className="mini-btn" disabled={busyUser === u.user_id}
                        onClick={() => void doFriendAction(u.user_id, () => clientRef.current!.friendAction("accept", u.user_id))}>同意</button>
                    ) : st === "blocked" ? (
                      <button className="mini-btn ghost" disabled>已拉黑</button>
                    ) : (
                      <button className="mini-btn" disabled={busyUser === u.user_id}
                        onClick={() => void doFriendAction(u.user_id, () => clientRef.current!.friendAction("request", u.user_id))}>加好友</button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {incoming.length > 0 && (
          <>
            <div className="section-label">新的朋友（{incoming.length}）</div>
            {incoming.map((f) => (
              <div key={`p-${f.user_id}`} className="convitem static">
                <Avatar url={f.avatar_url} label={labelOf(f.user_id, f.nickname)} seed={f.user_id} />
                <div className="convbody">
                  <div className="convpeer">{labelOf(f.user_id, f.nickname)}</div>
                  <div className="convlast">请求加你为好友</div>
                </div>
                <div className="row-actions">
                  <button className="mini-btn" disabled={busyUser === f.user_id}
                    onClick={() => void doFriendAction(f.user_id, () => clientRef.current!.friendAction("accept", f.user_id))}>同意</button>
                  <button className="mini-btn ghost" disabled={busyUser === f.user_id}
                    onClick={() => void doFriendAction(f.user_id, () => clientRef.current!.friendAction("reject", f.user_id))}>拒绝</button>
                </div>
              </div>
            ))}
          </>
        )}

        <div className="section-label with-action friends-head">
          <span>好友（{contactFilterQ ? `${filteredAccepted.length}/${accepted.length}` : accepted.length}）</span>
          {accepted.length > 0 && (
            <input className="contact-filter-input" value={contactFilter} placeholder="搜索好友"
              onChange={(e) => setContactFilter(e.target.value)} />
          )}
        </div>
        {accepted.length === 0 && <div className="empty">还没有好友，上面搜索用户添加吧</div>}
        {accepted.length > 0 && filteredAccepted.length === 0 && <div className="empty">没有匹配的好友</div>}
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
                <div className="convpeer">{friendLabel(f)}{f.blocked && <span className="tag-blocked">已拉黑</span>}</div>
                <div className="convlast">{f.user_id}</div>
              </div>
              <div className="row-actions">
                <button className="mini-btn ghost" title="更多"
                  onClick={(e) => { e.stopPropagation(); setFriendMenu({ x: e.clientX, y: e.clientY, userId: f.user_id }); }}>⋯</button>
              </div>
            </div>
          )}
        />
      </div>
    </div>
  );
}
