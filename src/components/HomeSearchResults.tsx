// HomeSearchResults：首页全局搜索三分组结果（会话 / 联系人 / 聊天记录，SEARCH_DESIGN §3）。
// 从 App.tsx 平移的**纯展示组件**（数据/派生仍在 App，经 props 注入）——仅为控制 App.tsx 体量（CODING_STYLE §7）。
import type { ReactNode } from "react";
import { Avatar } from "./Avatar";
import type { Conversation, FriendEntry } from "../sdk/protocol";
import type { MsgRecord } from "../sdk/localStore";

export function HomeSearchResults(p: {
  homeConvHits: Conversation[];
  homeFriendHits: FriendEntry[];
  homeRecordGroups: { convId: string; count: number; latest: MsgRecord }[];
  convAvatarUrl: (c: Conversation) => string | undefined;
  convDisplayLabel: (c: Conversation) => string;
  friendLabel: (f: FriendEntry) => string;
  convById: (cid: string) => Conversation | undefined;
  recordSnippet: (r: MsgRecord) => string;
  highlight: (text: string, keyBase: string) => ReactNode;
  openConvById: (cid: string) => void;
  openPeerDetail: (uid: string) => void;
  onRecordClick: (convId: string) => void;
}) {
  return (
    <div className="home-results">
      {p.homeConvHits.length > 0 && <div className="section-label">会话</div>}
      {p.homeConvHits.map((c) => (
        <div key={`hc-${c.conv_id}`} className="convitem" onClick={() => p.openConvById(c.conv_id)}>
          <Avatar url={p.convAvatarUrl(c)} label={p.convDisplayLabel(c)} seed={c.is_group ? c.conv_id : c.peer} />
          <div className="convbody">
            <div className="convpeer">{p.highlight(p.convDisplayLabel(c), `hcn-${c.conv_id}`)}</div>
            <div className="convlast">{c.is_group ? `${c.member_count ?? 0} 位成员` : c.peer}</div>
          </div>
        </div>
      ))}
      {p.homeFriendHits.length > 0 && <div className="section-label">联系人</div>}
      {p.homeFriendHits.map((f) => (
        <div key={`hf-${f.user_id}`} className="convitem" onClick={() => p.openPeerDetail(f.user_id)}>
          <Avatar url={f.avatar_url} label={p.friendLabel(f)} seed={f.user_id} />
          <div className="convbody">
            <div className="convpeer">{p.highlight(p.friendLabel(f), `hfn-${f.user_id}`)}</div>
            <div className="convlast">好友 · {f.user_id}</div>
          </div>
        </div>
      ))}
      {p.homeRecordGroups.length > 0 && <div className="section-label">聊天记录</div>}
      {p.homeRecordGroups.map((g) => {
        const c = p.convById(g.convId);
        const name = c ? p.convDisplayLabel(c) : g.convId;
        return (
          <div key={`hr-${g.convId}`} className="convitem" onClick={() => p.onRecordClick(g.convId)}>
            <Avatar url={c ? p.convAvatarUrl(c) : undefined} label={name} seed={c && c.is_group ? c.conv_id : (c?.peer ?? g.convId)} />
            <div className="convbody">
              <div className="convpeer">{name} · {g.count} 条相关消息</div>
              <div className="convlast">{p.highlight(p.recordSnippet(g.latest), `hrs-${g.convId}`)}</div>
            </div>
          </div>
        );
      })}
      {p.homeConvHits.length === 0 && p.homeFriendHits.length === 0 && p.homeRecordGroups.length === 0 && (
        <div className="empty">未找到相关内容</div>
      )}
    </div>
  );
}
