import { useRef, type MouseEvent, type RefObject } from "react";
import { useAutoLoadMore } from "../useAutoLoadMore";
import { UserPlus, Search, X } from "lucide-react";
import type { ChatMessage, GroupInfo, GroupMember } from "../sdk/protocol";
import { VirtualList } from "../VirtualList";
import type { MemberSearchState } from "../useMemberSearch";
import type { DownloadState } from "../download";
import { downloadText } from "../download";
import { formatFileSize } from "../fileMetadata";
import { fileNameFromContent, isPreviewableFile, firstURLInText } from "../messageContent";
import { msgKey } from "../album";
import { memberSubtitle } from "../groupAdmin";
import { Avatar } from "./Avatar";
import { MediaTile } from "./MediaTile";
import { FileGateIcon } from "./FileGateIcon";
import { FileTypeIcon } from "../FileTypeIcon";
import { DetailLinkItem } from "./DetailLinkItem";
import { ContactRow } from "./ContactRow";
import { parseContactCard } from "../contactCard";
import { VoiceBubble } from "./VoiceBubble";
import type { LinkPreview } from "./LinkCard";

/** 详情页各 tab 的统一时间口径（"年月日 时:分"，与 iOS IMFormatFileDateTime 对齐）：
 *  语音 / 名片 / 文件 / 链接四个 tab 共用一套格式，别再各写各的。 */
function detailFullDateTime(ts: number): string {
  if (!ts || ts <= 0) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export type DetailTab = "members" | "media" | "files" | "voice" | "links" | "contacts";

/**
 * 成员列表启用虚拟化的行数阈值。
 *
 * 低于它走原来的全量 map：虚拟化有它自己的失败模式（滚动容器测不出高度时退化为只渲染前若干行，
 * 见 VirtualList「零高度兜底」），几十个人的群没必要为此买单。
 * **2000 人的普通群同样吃这条路**——服务端一次全量下发 `gp.members`，行数和超级群翻满页一样多；
 * 只按 `is_super` 分流会漏掉它（实测 2000 人群面板 136839px / DOM 12291 节点）。
 */
const VIRTUALIZE_MEMBERS_FROM = 50;
/** `.detail-member` 首帧行高估算（padding 8+8 + 头像 52）；真实行高由 VirtualList 首行实测覆盖。 */
const MEMBER_ROW_EST_H = 68;

/**
 * 单个成员行。抽成组件是为了让「全量 map」与「虚拟化」两条路径渲染**同一段 JSX**——
 * 两处各抄一份，迟早会在其中一份上漏掉禁言标签、管理按钮这类后加的东西，
 * 而那种 bug 只在大群（走虚拟化那条）才看得见。
 */
function MemberRow({ m, gp, uid, memberLabel, onOpenMember, canManageMember, onMemberMenu }: {
  m: GroupMember;
  gp: GroupInfo;
  uid: string;
  memberLabel: (m: GroupMember) => string;
  onOpenMember: (userId: string) => void;
  canManageMember: (gp: GroupInfo, m: GroupMember) => boolean;
  onMemberMenu: (e: MouseEvent, cid: string, m: GroupMember) => void;
}) {
  return (
    <div className="detail-member"
      onClick={() => m.user_id !== uid && onOpenMember(m.user_id)} role="button">
      <Avatar url={m.avatar_url} label={memberLabel(m)} seed={m.user_id} />
      <div className="detail-member-body">
        <div className="detail-member-name">{memberLabel(m)}{m.user_id === uid && <span className="me-tag">我</span>}</div>
        {/* 副行 = 群昵称 / @句柄 / 空。**绝不显示 user_id**——那是 10 位随机内部 ID
            （docs/design/ACCOUNT_IDENTITY_REDESIGN.md §5.2）。 */}
        <div className="detail-member-sub">{memberSubtitle(m)}</div>
      </div>
      {/* G2 被禁言标签：服务端把「永久」归一为大正数（MutePermanent = 1<<62），直接 >now 判定。
          与 role 徽标同排、居右紧挨（role 左侧），未禁言时不渲染，不占位。 */}
      {(m.mute_until ?? 0) > Date.now() && <span className="role-badge mute">禁言中</span>}
      {m.role === "owner" && <span className="role-badge owner">群主</span>}
      {m.role === "admin" && <span className="role-badge">管理员</span>}
      {canManageMember(gp, m) && (
        <button className="mini-btn ghost" title="管理"
          onClick={(e) => { e.stopPropagation(); onMemberMenu(e, gp.conv_id, m); }}>⋯</button>
      )}
    </div>
  );
}

// 会话详情抽屉的页签区（成员 / 媒体 / 文件 / 语音 / 链接 / 名片）。纯展示：数据与动作全经 props 注入。
// DOM/className/结构与原 App 内联逐字一致（行为等价）。媒体/文件门控与聊天气泡共用 MediaTile/FileGateIcon。
export function DetailTabs({
  tabs, activeTab, onSelectTab, gp, uid, media, files, voices, voiceSenderLabel, links,
  contacts, contactDisplayName, contactSourceLabel, onOpenContact,
  canInvite, onAddMember, onOpenMember, canManageMember, onMemberMenu, memberLabel,
  members: membersOverride, hasMoreMembers, onLoadMoreMembers, membersLoading, scrollElRef, search, upgradeHint,
  mediaGate, mediaSrc, onGateTap, onOpenViewer, onFileMenu, onMediaError, onOpenFile,
  fetchLinkPreview,
}: {
  tabs: Array<{ k: DetailTab; label: string }>;
  activeTab: DetailTab;
  onSelectTab: (k: DetailTab) => void;
  gp: GroupInfo | undefined;
  uid: string;
  media: ChatMessage[];
  files: ChatMessage[];
  voices: ChatMessage[]; // 语音 tab（2026-08-26）：voice/audio 消息，VoiceBubble 就地播放
  voiceSenderLabel?: (m: ChatMessage) => string; // 三行行头「发送者」显名（"你自己" / 昵称 / uid），2026-08-27
  links: ChatMessage[];
  contacts: ChatMessage[];        // 名片 tab（contact 消息，解析不出的脏名片已由调用方过滤）
  /** 名片主行显示名（备注 > 快照昵称 > uid）；由调用方按 remarks 解析后注入，本组件不查 store。 */
  contactDisplayName?: (userId: string, fallback?: string) => string;
  /** 名片行副行的「由 X 分享」显示名；群聊传、单聊不传（发送者只可能是我或对方，写出来纯冗余）。 */
  contactSourceLabel?: (m: ChatMessage) => string | undefined;
  /** 点名片行 → 名片里那个人的资料页（与点气泡同一落点）。 */
  onOpenContact: (userId: string) => void;
  /**
   * 成员列表的数据源。缺省用 `gp.members`（普通群，服务端一次全量下发）。
   * **超级群必须传**：那时 `gp.members` 只含我自己（2 万人约 2.5MB，服务端不再全量下发），
   * 由父组件走 `groupMembersPage` 分页取。
   */
  members?: GroupMember[];
  hasMoreMembers?: boolean;          // 还有下一页 → 渲染「加载更多」
  onLoadMoreMembers?: () => void;    // 点「加载更多」
  /** 下一页正在路上。用来把按钮切成「加载中…」，并避免自动续拉在在途期间空转。 */
  membersLoading?: boolean;
  /**
   * 详情抽屉那个滚动容器（`.detail-panel`）的 ref，成员列表虚拟化要用它算可见区。
   * 不传 = 不虚拟化（全量渲染），功能不受影响，只是大群会卡。
   */
  scrollElRef?: RefObject<HTMLElement | null>;
  /**
   * 成员搜索（`useMemberSearch`）。**恒走服务端**——超级群本地只有已翻到的那几页，
   * 本地过滤等于在 50 人里搜 2 万人。不传 = 不显示搜索框（列表照常）。
   */
  search?: MemberSearchState;
  /**
   * 满员告知（普通群人满 + 本部署开了超级群时才由调用方传入；否则不传 = 不显示）。
   * 判定放调用方：它才拿得到 `GET /server-config` 的部署能力，本组件是纯展示。
   */
  upgradeHint?: { maxMembers: number; maxSuperMembers: number; onCopyGroupID: () => void };
  canInvite: boolean;
  onAddMember: (cid: string) => void;
  onOpenMember: (userId: string) => void;
  canManageMember: (gp: GroupInfo, m: GroupMember) => boolean;
  onMemberMenu: (e: MouseEvent, cid: string, m: GroupMember) => void;
  /** 群成员在**本机**列表里的显示名：备注 > 群昵称 > 全局昵称 > uid（会发出去的内容仍用公开名）。 */
  memberLabel: (m: GroupMember) => string;
  mediaGate: (m: ChatMessage) => DownloadState | undefined;
  mediaSrc: (m: ChatMessage) => string; // blob 缓存优先解析（语音 tab 用；与聊天气泡同口径）
  onGateTap: (m: ChatMessage) => void;
  onOpenViewer: (m: ChatMessage) => void;
  onFileMenu: (e: MouseEvent, m: ChatMessage) => void;
  onMediaError: (m: ChatMessage) => void;
  onOpenFile: (m: ChatMessage) => void;
  fetchLinkPreview: (u: string) => Promise<LinkPreview>;
}) {
  // ==== 成员列表的「滚到底自动续拉」（PERF-members-autoload）====
  // Hook 必须在组件顶层调用，故把这几个派生值提到 return 之前（下面的成员 Tab 直接复用，
  // 别再算第二份——两份判据迟早分叉）。
  const fallbackScrollRef = useRef<HTMLElement | null>(null); // scrollElRef 可不传；hook 依赖数组要一个稳定的 ref
  const memberSearching = !!search?.needle;
  const memberBrowseList = membersOverride ?? gp?.members ?? [];
  const memberList = memberSearching ? (search?.results ?? []) : memberBrowseList;
  useAutoLoadMore(scrollElRef ?? fallbackScrollRef, {
    // 只在成员 Tab 打开时挂监听；媒体/文件等 Tab 共用同一个滚动容器，不加这个判断会在别的 Tab 里乱拉页。
    enabled: activeTab === "members"
      && (memberSearching ? !!search?.hasMore && !search.loading : !!hasMoreMembers && !membersLoading),
    // 浏览态翻成员分页，搜索态翻结果分页——同一个接口，两份游标。
    onLoadMore: () => { if (memberSearching) { search?.loadMore(); } else { onLoadMoreMembers?.(); } },
    signal: memberList.length,
  });
  return (
    <>
      <div className="detail-tabs">
        {tabs.map((t) => (
          <button key={t.k} className={`detail-tab ${activeTab === t.k ? "active" : ""}`} onClick={() => onSelectTab(t.k)}>{t.label}</button>
        ))}
      </div>
      <div className="detail-tabbody">
        {activeTab === "members" && gp && (() => {
          const browseList = memberBrowseList;  // 与上面自动续拉用的是同一份，别再算一遍
          const searching = memberSearching;
          const list = memberList;
          const rest = { gp, uid, memberLabel, onOpenMember, canManageMember, onMemberMenu };
          // 搜索框只在「一屏装不下」时出现（与虚拟化同阈值）。几十人的群整张列表就在眼前，
          // 为 5 个人打一次网络请求不合理。判据用**群总人数**而非已加载行数——
          // 超级群刚进来只有 50 行，看行数会把 2 万人的群判成小群。
          const total = gp.member_count ?? browseList.length;
          const showSearch = !!search && total > VIRTUALIZE_MEMBERS_FROM;
          return (
            <div className="detail-members">
              {showSearch && (
                // 吸顶：整个 .detail-panel 是一个滚动容器，不吸顶的话滚到几千行以后想搜
                // 就得先滚回顶——而"滚了半天没找到才想起来搜"正是最常见的那条路径。
                <div className="detail-member-search">
                  <Search size={14} className="detail-member-search-ic" />
                  <input value={search.query} placeholder="搜索成员" aria-label="搜索成员"
                    autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    onChange={(e) => search.setQuery(e.target.value)} />
                  {search.query && (
                    <button className="detail-member-search-x" title="清空" onClick={() => search.clear()}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              )}
              {/* 「仅管理员可邀请」开启且我非管理员 → 隐藏「添加成员」（对齐 iOS；服务端仍是权威闸门）。
                  搜索态也隐藏：它属于浏览态，混在搜索结果里只会被误点。 */}
              {canInvite && !searching && (
                <button className="detail-row accent" onClick={() => onAddMember(gp.conv_id)}>
                  <span className="detail-row-ic"><UserPlus size={18} /></span><span>添加成员</span>
                </button>
              )}
              {/* 满员告知。**只在人满那一刻现身**，不做常驻入口——升级不可逆，平时挂在那儿
                  只会诱导用户在不需要的时候去点（对齐 Telegram 的 MEMBERS LIMIT REACHED）。
                  第一版只「告知」不「申请」：审批流要先有审批人，而管理后台还没有工单队列，
                  真做出来就是"用户点了申请、运营得自己想起来去后台翻"（TASKS C-superupgrade）。 */}
              {!searching && upgradeHint && (
                <div className="detail-upgrade-note">
                  <div className="detail-upgrade-title">成员已达上限 {upgradeHint.maxMembers}</div>
                  <div>
                    升级为大群可容纳至 {upgradeHint.maxSuperMembers} 人，请联系管理员办理。
                    升级后已读回执与「正在输入」将不再显示，且**不可撤销**。
                  </div>
                  <button className="mini-btn ghost" onClick={() => upgradeHint.onCopyGroupID()}>
                    复制群 ID
                  </button>
                </div>
              )}
              {searching && list.length === 0 && !search.loading && (
                // 与「群里还没有其他成员」区分开——两种空是两回事。
                <div className="detail-empty">{search.failed ? "搜索失败，请重试" : "没有匹配的成员"}</div>
              )}
              {(() => {
                // 大列表只渲染视口内的行，DOM 从 N 降到几十。缺 scrollElRef 时（未注入滚动父）
                // 一律退回全量 map——宁可慢，也不能因为量不到滚动容器而少显示人。
                // 搜索结果同样走这条：搜 "big" 能命中几千人，结果本身就是长列表。
                return list.length > VIRTUALIZE_MEMBERS_FROM && scrollElRef ? (
                  <VirtualList
                    items={list}
                    scrollElRef={scrollElRef}
                    getKey={(m) => m.user_id}
                    estimateSize={MEMBER_ROW_EST_H}
                    renderRow={(m) => <MemberRow m={m} {...rest} />}
                  />
                ) : (
                  list.map((m) => <MemberRow key={m.user_id} m={m} {...rest} />)
                );
              })()}
              {/* 续拉。滚到底会自动触发（见上面的 useAutoLoadMore），这个按钮保留为
                  **失败重试入口**——自动续拉遇到网络错误就停在那儿，没有它用户只能关掉重开抽屉。 */}
              {searching
                ? search.hasMore && (
                    <button className="detail-row" onClick={() => search.loadMore()}>
                      <span>{search.loading ? "加载中…" : "加载更多结果"}</span>
                    </button>
                  )
                : hasMoreMembers && (
                    <button className="detail-row" onClick={() => onLoadMoreMembers?.()}>
                      <span>{membersLoading ? "加载中…" : "加载更多成员"}</span>
                    </button>
                  )}
            </div>
          );
        })()}
        {activeTab === "media" && (
          media.length === 0 ? <div className="detail-empty">暂无媒体</div> : (
            <div className="detail-media-grid">
              {/* 门控格子与会话媒体库共用 <MediaTile>（variant=detail：失效格无 ↓ 徽标、仍显尺寸）。
                  点门控格=就地解门控（不进查看器），就绪格才打开查看器（对齐 iOS 详情宫格 档 A，autoPrefetch=NO）。 */}
              {media.map((m) => {
                const gate = mediaGate(m);
                return (
                  <MediaTile key={msgKey(m)} variant="detail" m={m} gate={gate}
                    onClick={(mm) => (gate ? onGateTap(mm) : onOpenViewer(mm))}
                    onMenu={(e, mm) => onFileMenu(e, mm)}
                    onMediaError={(mm) => onMediaError(mm)} />
                );
              })}
            </div>
          )
        )}
        {activeTab === "files" && (
          files.length === 0 ? <div className="detail-empty">暂无文件</div> : (
            <div className="detail-filelist">
              {files.map((m) => {
                // 与聊天气泡共用门控/下载缓存（对齐 iOS 详情与聊天共享 IMMediaDownloadCoordinator）：
                // 未下载→点击就地下载（圆形图标+环形进度）；就绪→预览/另存。右键=转发/定位/取消下载/删除。
                const gate = mediaGate(m);
                const name = m.fileName || fileNameFromContent(m.content);
                return (
                  <div key={msgKey(m)}
                       className={`detail-fileitem${gate && (gate.phase === "failed" || gate.phase === "expired") ? " failed" : ""}`}
                       onClick={() => (gate ? onGateTap(m) : onOpenFile(m))}
                       onContextMenu={(e) => { e.preventDefault(); onFileMenu(e, m); }}
                       title={gate ? (gate.phase === "expired" ? "文件已失效" : "点击下载")
                                  : (isPreviewableFile(name) ? "点击预览" : "点击下载")}>
                    {gate ? <FileGateIcon state={gate} /> : <FileTypeIcon name={name} size={34} />}
                    <span className="detail-file-body">
                      <span className="detail-file-name">{name}</span>
                      <span className="detail-file-size">
                        {gate
                          ? (gate.phase === "notStarted"
                              ? (formatFileSize(m.fileSize) ? `${formatFileSize(m.fileSize)} · 未下载` : "未下载")
                              : downloadText(gate, formatFileSize(m.fileSize)))
                          : (formatFileSize(m.fileSize) || "")}
                      </span>
                      {/* 文件行第三行 = 收到/发出时间（与语音/名片/链接 tab 同一「年月日 时:分」口径）。
                          曾整个文件 tab 不显时间，四个 tab 里只有它看不出这份文件是什么时候的（用户反馈）。 */}
                      <span className="detail-file-time">{detailFullDateTime(m.timestamp)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )
        )}
        {activeTab === "voice" && (
          voices.length === 0 ? <div className="detail-empty">暂无语音</div> : (
            // 语音 tab（2026-08-27 sketch §10 三行格式）：发送者 / 迷你播放器（含波形进度=声纹）/ 年月日时分。
            <div className="detail-filelist detail-voicelist">
              {voices.map((m) => {
                const mine = m.from === uid;
                const senderText = mine ? "你自己" : (voiceSenderLabel ? voiceSenderLabel(m) : (m.fromNickname || m.from));
                return (
                  <div key={msgKey(m)} className="detail-voice-row3"
                       onContextMenu={(e) => { e.preventDefault(); onFileMenu(e, m); }}>
                    <div className="detail-voice-sender">{senderText}</div>
                    <div className="detail-voice-mini">
                      {/* variant=mini：关背景/内 padding，仅留 ▶ + 波形 + 时长横排（与 IMVoiceMiniPlayerView 同款） */}
                      <VoiceBubble m={m} mine={false} uid={uid} audioSrc={mediaSrc(m)} variant="mini" />
                    </div>
                    <div className="detail-voice-time">{detailFullDateTime(m.timestamp)}</div>
                  </div>
                );
              })}
            </div>
          )
        )}
        {activeTab === "links" && (
          links.length === 0 ? <div className="detail-empty">暂无链接</div> : (
            // 详情页链接 tab（草图 §C）：36×36 favicon + t1 og:title(host 兜底) + t2 host+path(mono) + t3 时间。
            // 无来源、无原文预览（收藏页 §E 才有 source）；点整行=打开链接。
            <div className="detail-filelist">
              {links.map((m) => {
                // 混排文本 "看看 https://foo.com 好"：url 只取首个 URL，否则把整段中文喂给 preview API → 404。
                const url = firstURLInText(m.content) || m.content;
                return (
                  <DetailLinkItem key={msgKey(m)} url={url}
                    timeText={detailFullDateTime(m.timestamp)}
                    fetchPreview={fetchLinkPreview}
                    onContextMenu={(e) => { e.preventDefault(); onFileMenu(e, m); }} />
                );
              })}
            </div>
          )
        )}
        {activeTab === "contacts" && (
          contacts.length === 0 ? <div className="detail-empty">暂无名片</div> : (
            // 行组件 ContactRow **与收藏页「名片」分类共用**（§7.1）——这就是"收藏页复用资料详情页"的落地方式。
            <div className="detail-filelist">
              {contacts.map((m) => {
                const card = parseContactCard(m.content);
                if (!card) return null;   // 理论到不了：脏名片已在数据源侧过滤
                return (
                  <ContactRow key={msgKey(m)} card={card}
                    displayName={contactDisplayName?.(card.userId, card.nickname) ?? card.nickname}
                    sourceName={contactSourceLabel?.(m)}
                    timeText={detailFullDateTime(m.timestamp)}
                    onClick={() => onOpenContact(card.userId)}
                    onContextMenu={(e) => { e.preventDefault(); onFileMenu(e, m); }} />
                );
              })}
            </div>
          )
        )}
      </div>
    </>
  );
}
