import type { MouseEvent } from "react";
import { UserPlus } from "lucide-react";
import type { ChatMessage, GroupInfo, GroupMember } from "../sdk/protocol";
import type { DownloadState } from "../download";
import { downloadText } from "../download";
import { formatFileSize } from "../fileMetadata";
import { fileNameFromContent, isPreviewableFile, firstURLInText } from "../messageContent";
import { msgKey } from "../album";
import { Avatar } from "./Avatar";
import { MediaTile } from "./MediaTile";
import { FileGateIcon } from "./FileGateIcon";
import { FileTypeIcon } from "../FileTypeIcon";
import { DetailLinkItem } from "./DetailLinkItem";
import { VoiceBubble } from "./VoiceBubble";
import type { LinkPreview } from "./LinkCard";

// 详情页链接 tab 的时间格式（草图 §C：HH:mm / 昨天 HH:mm / M月d日）——先用最小实现：
// 今日→HH:mm；昨日→"昨天 HH:mm"；更早→"M月d日"（跨年不特殊，年份不显）。iOS 侧沿用 IMFormatFileDateTime 完整时间，
// 视觉略有出入但语义一致（快速迭代，等收藏页 §E 统一改造再对齐）。
function detailLinkTimeText(ts: number): string {
  if (!ts || ts <= 0) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return hm;
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export type DetailTab = "members" | "media" | "files" | "voice" | "links";

// 会话详情抽屉的页签区（成员 / 媒体 / 文件 / 链接）。纯展示：数据与动作全经 props 注入。
// DOM/className/结构与原 App 内联逐字一致（行为等价）。媒体/文件门控与聊天气泡共用 MediaTile/FileGateIcon。
export function DetailTabs({
  tabs, activeTab, onSelectTab, gp, uid, media, files, voices, links,
  canInvite, onAddMember, onOpenMember, canManageMember, onMemberMenu,
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
  links: ChatMessage[];
  canInvite: boolean;
  onAddMember: (cid: string) => void;
  onOpenMember: (userId: string) => void;
  canManageMember: (gp: GroupInfo, m: GroupMember) => boolean;
  onMemberMenu: (e: MouseEvent, cid: string, m: GroupMember) => void;
  mediaGate: (m: ChatMessage) => DownloadState | undefined;
  mediaSrc: (m: ChatMessage) => string; // blob 缓存优先解析（语音 tab 用；与聊天气泡同口径）
  onGateTap: (m: ChatMessage) => void;
  onOpenViewer: (m: ChatMessage) => void;
  onFileMenu: (e: MouseEvent, m: ChatMessage) => void;
  onMediaError: (m: ChatMessage) => void;
  onOpenFile: (m: ChatMessage) => void;
  fetchLinkPreview: (u: string) => Promise<LinkPreview>;
}) {
  return (
    <>
      <div className="detail-tabs">
        {tabs.map((t) => (
          <button key={t.k} className={`detail-tab ${activeTab === t.k ? "active" : ""}`} onClick={() => onSelectTab(t.k)}>{t.label}</button>
        ))}
      </div>
      <div className="detail-tabbody">
        {activeTab === "members" && gp && (
          <div className="detail-members">
            {/* 「仅管理员可邀请」开启且我非管理员 → 隐藏「添加成员」（对齐 iOS；服务端仍是权威闸门）。 */}
            {canInvite && (
              <button className="detail-row accent" onClick={() => onAddMember(gp.conv_id)}>
                <span className="detail-row-ic"><UserPlus size={18} /></span><span>添加成员</span>
              </button>
            )}
            {gp.members.map((m) => (
              <div key={m.user_id} className="detail-member"
                onClick={() => m.user_id !== uid && onOpenMember(m.user_id)} role="button">
                <Avatar url={m.avatar_url} label={m.group_nickname || m.nickname || m.user_id} seed={m.user_id} />
                <div className="detail-member-body">
                  <div className="detail-member-name">{m.group_nickname || m.nickname || m.user_id}{m.user_id === uid && <span className="me-tag">我</span>}</div>
                  <div className="detail-member-sub">{m.user_id}</div>
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
            ))}
          </div>
        )}
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
                    </span>
                  </div>
                );
              })}
            </div>
          )
        )}
        {activeTab === "voice" && (
          voices.length === 0 ? <div className="detail-empty">暂无语音</div> : (
            // 语音 tab（2026-08-26）：复用聊天气泡 VoiceBubble（波形 + scrub + 倍速 + 就地播放）；
            // 右侧补时间；右键=转发/定位菜单（与文件行同一注入面 onFileMenu）。
            <div className="detail-filelist detail-voicelist">
              {voices.map((m) => (
                <div key={msgKey(m)} className="detail-voiceitem"
                     onContextMenu={(e) => { e.preventDefault(); onFileMenu(e, m); }}>
                  <VoiceBubble m={m} mine={false} uid={uid} audioSrc={mediaSrc(m)} />
                  <span className="detail-voice-time">{detailLinkTimeText(m.timestamp)}</span>
                </div>
              ))}
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
                    timeText={detailLinkTimeText(m.timestamp)}
                    fetchPreview={fetchLinkPreview}
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
