import type { MouseEvent } from "react";
import { UserPlus, Link2 } from "lucide-react";
import type { ChatMessage, GroupInfo, GroupMember } from "../sdk/protocol";
import type { DownloadState } from "../download";
import { downloadText } from "../download";
import { formatFileSize } from "../fileMetadata";
import { fileNameFromContent, isPreviewableFile } from "../messageContent";
import { msgKey } from "../album";
import { Avatar } from "./Avatar";
import { MediaTile } from "./MediaTile";
import { FileGateIcon } from "./FileGateIcon";
import { FileTypeIcon } from "../FileTypeIcon";

export type DetailTab = "members" | "media" | "files" | "links";

// 会话详情抽屉的页签区（成员 / 媒体 / 文件 / 链接）。纯展示：数据与动作全经 props 注入。
// DOM/className/结构与原 App 内联逐字一致（行为等价）。媒体/文件门控与聊天气泡共用 MediaTile/FileGateIcon。
export function DetailTabs({
  tabs, activeTab, onSelectTab, gp, uid, media, files, links,
  canInvite, onAddMember, onOpenMember, canManageMember, onMemberMenu,
  mediaGate, onGateTap, onOpenViewer, onFileMenu, onMediaError, onOpenFile,
}: {
  tabs: Array<{ k: DetailTab; label: string }>;
  activeTab: DetailTab;
  onSelectTab: (k: DetailTab) => void;
  gp: GroupInfo | undefined;
  uid: string;
  media: ChatMessage[];
  files: ChatMessage[];
  links: ChatMessage[];
  canInvite: boolean;
  onAddMember: (cid: string) => void;
  onOpenMember: (userId: string) => void;
  canManageMember: (gp: GroupInfo, m: GroupMember) => boolean;
  onMemberMenu: (e: MouseEvent, cid: string, m: GroupMember) => void;
  mediaGate: (m: ChatMessage) => DownloadState | undefined;
  onGateTap: (m: ChatMessage) => void;
  onOpenViewer: (m: ChatMessage) => void;
  onFileMenu: (e: MouseEvent, m: ChatMessage) => void;
  onMediaError: (m: ChatMessage) => void;
  onOpenFile: (m: ChatMessage) => void;
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
        {activeTab === "links" && (
          links.length === 0 ? <div className="detail-empty">暂无链接</div> : (
            <div className="detail-filelist">
              {links.map((m) => (
                <a key={msgKey(m)} className="detail-linkitem" href={m.content} target="_blank" rel="noreferrer"
                   onContextMenu={(e) => { e.preventDefault(); onFileMenu(e, m); }}>
                  <Link2 size={16} /><span className="detail-file-name">{m.content}</span>
                </a>
              ))}
            </div>
          )
        )}
      </div>
    </>
  );
}
