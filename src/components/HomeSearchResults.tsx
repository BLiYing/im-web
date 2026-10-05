// HomeSearchResults：首页全局搜索三分组结果（会话 / 联系人 / 聊天记录，SEARCH_DESIGN §3）。
// 从 App.tsx 平移的**纯展示组件**（数据/派生仍在 App，经 props 注入）——仅为控制 App.tsx 体量（CODING_STYLE §7）。
import type { ReactNode } from "react";
import { Avatar } from "./Avatar";
import type { Conversation, FriendEntry } from "../sdk/protocol";
import type { MsgRecord } from "../sdk/localStore";
import { useT } from "../i18n";
import { filterSettingsEntries, settingsSearchEntries, settingsSubtitle, type SettingsSearchEntry } from "../settingsSearch";

export function HomeSearchResults(p: {
  homeConvHits: Conversation[];
  homeFriendHits: FriendEntry[];
  /** 聊天记录命中：**不聚合**，一条命中一行（同会话可多行，预期内；与 iOS 对齐）。新→旧。 */
  homeRecordHits: MsgRecord[];
  convAvatarUrl: (c: Conversation) => string | undefined;
  convDisplayLabel: (c: Conversation) => string;
  friendLabel: (f: FriendEntry) => string;
  convById: (cid: string) => Conversation | undefined;
  recordSnippet: (r: MsgRecord) => string;
  highlight: (text: string, keyBase: string) => ReactNode;
  openConvById: (cid: string) => void;
  openPeerDetail: (uid: string) => void;
  /** 点聊天记录行：直接打开会话并定位到最近命中那条（不开会话内搜索模式），seq=最近命中 convSeq。 */
  onRecordClick: (convId: string, seq: number) => void;
  /** 当前（已小写）搜索词：设置项命中在本组件内按当前语言现算，不占 App 状态。 */
  homeQ: string;
  /** 点设置项：关搜索、逐级打开目标页（接线在 App）。 */
  onOpenSettings: (e: SettingsSearchEntry) => void;
}) {
  const tr = useT();
  const settingsHits = filterSettingsEntries(settingsSearchEntries(tr), p.homeQ);
  return (
    <div className="home-results">
      {p.homeConvHits.length > 0 && <div className="section-label">{tr("search.section.conversations")}</div>}
      {p.homeConvHits.map((c) => (
        <div key={`hc-${c.conv_id}`} className="convitem" onClick={() => p.openConvById(c.conv_id)}>
          <Avatar url={p.convAvatarUrl(c)} label={p.convDisplayLabel(c)} seed={c.is_group ? c.conv_id : c.peer} />
          <div className="convbody">
            <div className="convpeer">{p.highlight(p.convDisplayLabel(c), `hcn-${c.conv_id}`)}</div>
            {/* 副行与 iOS 对齐：群显「N 人」，单聊无副行。 */}
            {c.is_group && <div className="convlast">{tr("search.result.member_count", { count: c.member_count ?? 0 })}</div>}
          </div>
        </div>
      ))}
      {p.homeFriendHits.length > 0 && <div className="section-label">{tr("search.section.contacts")}</div>}
      {p.homeFriendHits.map((f) => (
        <div key={`hf-${f.user_id}`} className="convitem" onClick={() => p.openPeerDetail(f.user_id)}>
          <Avatar url={f.avatar_url} label={p.friendLabel(f)} seed={f.user_id} />
          <div className="convbody">
            <div className="convpeer">{p.highlight(p.friendLabel(f), `hfn-${f.user_id}`)}</div>
            {/* 副行与 iOS 对齐：「联系人」。 */}
            <div className="convlast">{tr("search.section.contacts")}</div>
          </div>
        </div>
      ))}
      {p.homeRecordHits.length > 0 && <div className="section-label">{tr("search.section.records")}</div>}
      {p.homeRecordHits.map((r) => {
        const c = p.convById(r.convId);
        const name = c ? p.convDisplayLabel(c) : r.convId;
        return (
          <div key={`hr-${r.convId}-${r.convSeq}`} className="convitem" onClick={() => p.onRecordClick(r.convId, r.convSeq)}>
            <Avatar url={c ? p.convAvatarUrl(c) : undefined} label={name} seed={c && c.is_group ? c.conv_id : (c?.peer ?? r.convId)} />
            <div className="convbody">
              <div className="convpeer">{name}</div>
              {/* 副行 = 该条命中的内容摘要（命中词高亮；不聚合，与 iOS 对齐）。 */}
              <div className="convlast">{p.highlight(p.recordSnippet(r), `hrs-${r.convId}-${r.convSeq}`)}</div>
            </div>
          </div>
        );
      })}
      {settingsHits.length > 0 && <div className="section-label">{tr("search.section.settings")}</div>}
      {settingsHits.map((e) => (
        <div key={`hs-${e.id}`} className="convitem settings-hit" role="button" tabIndex={0} onClick={() => p.onOpenSettings(e)}
          onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); p.onOpenSettings(e); } }}>
          <span className={`row-icon-tile ${e.tint}`}><e.icon size={17} /></span>
          <div className="convbody">
            <div className="convpeer">{p.highlight(e.title, `hsn-${e.id}`)}</div>
            <div className="convlast">{settingsSubtitle(e, tr("settings.title"))}</div>
          </div>
        </div>
      ))}
      {p.homeConvHits.length === 0 && p.homeFriendHits.length === 0 && p.homeRecordHits.length === 0 && settingsHits.length === 0 && (
        <div className="empty">{tr("home.search.empty")}</div>
      )}
    </div>
  );
}
