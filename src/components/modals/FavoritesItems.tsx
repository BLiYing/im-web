import { Check, ChevronRight, Link as LinkIcon, MessageSquareQuote, MessagesSquare } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type { ChatMessage, Conversation, Favorite } from "../../sdk/protocol";
import type { DownloadState } from "../../download";
import { downloadText } from "../../download";
import { FileTypeIcon } from "../../FileTypeIcon";
import { fileNameFromContent, favoriteToMessage, isPreviewableFile, isUrlText, looksLikeChatRecordJSON, parseChatRecord } from "../../messageContent";
import { formatFileSize } from "../../fileMetadata";
import { favoritePreviewText, sourceGroupName, type FavoriteSourceGroup } from "../../favoritesGrouping";
import { MediaTile } from "../MediaTile";
import { FileGateIcon } from "../FileGateIcon";
import { Avatar } from "../Avatar";

/**
 * 收藏弹窗的各展示件（B 方案，FAVORITES_DESIGN §14 ③）：
 * 媒体 = 3 列宫格（复用详情页 MediaTile，逐格门控）；文件 = 三态行（复用详情页 detail-fileitem + FileGateIcon）；
 * 链接/文本/记录 = v1 统一图标行；聊天模式 = 来源会话分组行。纯展示，下载态/打开全由 App 注入的 glue 决定。
 */

/** 门控与打开的注入面：与聊天页/详情页同一套 useMediaDownload 机制（合成 ChatMessage 喂入，三页共享状态）。 */
export interface FavoritesMediaGlue {
  gateOf: (m: ChatMessage) => DownloadState | undefined; // undefined = 就绪
  onGateTap: (m: ChatMessage) => void;                   // 未下载→下载 / 下载中→取消 / 失败→重试
  onOpenFile: (m: ChatMessage) => void;                  // 就绪文件：预览或另存（openReadyFile）
  onMediaError: (m: ChatMessage) => void;                // 缩略加载失败 → 失效/不支持标记
}

/** 收藏项渲染类型（决定展示件）。语音落地前 audio/voice 暂按文件三态行兜底。 */
export type FavKind = "image" | "video" | "file" | "link" | "record" | "text";
export function favKind(f: Favorite): FavKind {
  const ct = f.content_type;
  if (ct === "image") return "image";
  if (ct === "video") return "video";
  if (ct === "file" || ct === "audio" || ct === "voice") return "file";
  // 合并转发「聊天记录」：内容是 JSON，须在 link/text 前拦下——否则会当纯文本显 JSON 串。
  if (ct === "chat_record" || looksLikeChatRecordJSON(f.content)) return "record";
  if (ct === "link" || (ct === "text" && isUrlText(f.content))) return "link";
  return "text";
}

/** 文件名：优先后端 file_name，空则从 URL 反推（老收藏兜底）。 */
export function favFileName(f: Favorite): string {
  return (f.file_name && f.file_name.trim()) || fileNameFromContent(f.content);
}

/** 收藏时间显示：年月日 时:分（与 iOS IMFormatFileDateTime 一致）。 */
export function favDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** 行右槽：pick 多选=勾选圈；browse=删除 ✕ 快捷。 */
export function FavTrailing({ pickMulti, on, onDelete }: { pickMulti: boolean; on: boolean; onDelete?: () => void }) {
  if (pickMulti) return <span className={`checkbox fav-check${on ? " on" : ""}`}>{on && <Check size={13} />}</span>;
  if (!onDelete) return null;
  return (
    <button className="fav-del" title="删除收藏" onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
  );
}

interface RowCommon {
  f: Favorite;
  on: boolean;                 // pick 多选选中
  pickMulti: boolean;
  sourceLabel: (f: Favorite) => string;
  onClick: () => void;
  onMenu?: (e: MouseEvent) => void;
  onDelete?: () => void;
}

/** 媒体 chip：3 列宫格，逐格门控（复用详情页 MediaTile variant=detail）。视频时长收藏无字段，不显。 */
export function FavMediaGrid({ favs, glue, pickMulti, selected, onTileClick, onMenu }: {
  favs: Favorite[];
  glue: FavoritesMediaGlue;
  pickMulti: boolean;
  selected: Set<number>;
  onTileClick: (f: Favorite, m: ChatMessage, gate: DownloadState | undefined) => void;
  onMenu?: (e: MouseEvent, f: Favorite) => void;
}) {
  return (
    <div className="fav-grid">
      {favs.map((f) => {
        const m = favoriteToMessage(f);
        const gate = glue.gateOf(m);
        const on = selected.has(f.id);
        return (
          <div key={f.id} className={`fav-tile${pickMulti && on ? " on" : ""}`}>
            <MediaTile variant="detail" m={m} gate={gate}
              onClick={() => onTileClick(f, m, gate)}
              onMenu={(e) => onMenu?.(e, f)}
              onMediaError={glue.onMediaError} />
            {pickMulti && <span className={`checkbox fav-tile-check${on ? " on" : ""}`}>{on && <Check size={13} />}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** 文件 chip：三态行（未下载 ↓ / 下载中环 / 已下载类型图标 / 失败 ↻），DOM 与详情页 detail-fileitem 同款。 */
export function FavFileRow({ f, on, pickMulti, glue, onClick, onMenu, onDelete }: Omit<RowCommon, "sourceLabel" | "onClick"> & {
  glue: FavoritesMediaGlue;
  onClick: (m: ChatMessage, gate: DownloadState | undefined) => void;
}) {
  const m = favoriteToMessage(f);
  const gate = glue.gateOf(m);
  const name = favFileName(f);
  const size = formatFileSize(f.file_size);
  const failed = !!gate && (gate.phase === "failed" || gate.phase === "expired");
  const meta = gate
    ? (gate.phase === "notStarted" ? (size ? `${size} · 未下载` : "未下载") : downloadText(gate, size))
    : size;
  return (
    <div className={`detail-fileitem fav-fileitem${failed ? " failed" : ""}${pickMulti && on ? " on" : ""}`}
      onClick={() => onClick(m, gate)} onContextMenu={onMenu}
      title={gate ? (gate.phase === "expired" ? "文件已失效" : "点击下载") : (isPreviewableFile(name) ? "点击预览" : "点击下载")}>
      {gate ? <FileGateIcon state={gate} /> : <FileTypeIcon name={name} size={34} />}
      <span className="detail-file-body">
        <span className="detail-file-name">{name}</span>
        {f.caption && <span className="fav-caption">{f.caption}</span>}
        {meta && <span className="detail-file-size">{meta}</span>}
      </span>
      <FavTrailing pickMulti={pickMulti} on={on} onDelete={onDelete} />
    </div>
  );
}

/** 链接 / 文本 / 聊天记录 chip：v1 统一左图标行（lucide on --accent-soft）。 */
export function FavRow({ f, on, pickMulti, sourceLabel, onClick, onMenu, onDelete }: RowCommon) {
  const k = favKind(f);
  let icon: ReactNode, body: ReactNode;
  if (k === "link") {
    icon = <LinkIcon size={22} />;
    body = <div className="fav-content link">{f.content}</div>;
  } else if (k === "record") {
    const r = parseChatRecord(f.content);
    icon = <MessagesSquare size={22} />;
    body = <div className="fav-content">{r.t || "聊天记录"}<span className="fav-record-count"> · {r.items.length} 条消息</span></div>;
  } else {
    icon = <MessageSquareQuote size={22} />;
    body = <div className="fav-content">{f.content}</div>;
  }
  return (
    <div className={`fav-item${pickMulti && on ? " on" : ""}`} onClick={onClick} onContextMenu={onMenu}>
      <div className={`fav-icon ${k}`}>{icon}</div>
      <div className="fav-main">
        {body}
        <div className="fav-meta">
          <span className="fav-src">来自{sourceLabel(f)}</span>
          {favDate(f.created_at) && <> · {favDate(f.created_at)}</>}
        </div>
      </div>
      <FavTrailing pickMulti={pickMulti} on={on} onDelete={onDelete} />
    </div>
  );
}

/** 聊天模式：来源会话分组行（头像 + 名 + 最近预览 + 计数），点进按来源过滤的分签页。 */
export function FavSourceList({ groups, conversations, myUid, convDisplayLabel, convAvatarUrl, onOpen }: {
  groups: FavoriteSourceGroup[];
  conversations: Conversation[];
  myUid: string;
  convDisplayLabel: (c: Conversation) => string;
  convAvatarUrl: (c: Conversation) => string | undefined;
  onOpen: (g: FavoriteSourceGroup) => void;
}) {
  return (
    <div className="fav-list fav-src-list">
      {groups.map((g) => {
        const conv = g.convId ? conversations.find((c) => c.conv_id === g.convId) : undefined;
        const name = sourceGroupName(g, () => (conv ? convDisplayLabel(conv) : undefined));
        const seed = g.isMine ? myUid : conv ? (conv.is_group ? conv.conv_id : conv.peer) : g.convId || "";
        return (
          <button key={g.key} className="fav-src-row" onClick={() => onOpen(g)}>
            <Avatar url={conv ? convAvatarUrl(conv) : undefined} label={g.isMine ? "我" : name} seed={seed} />
            <span className="fav-src-main">
              <span className="fav-src-name">{name}</span>
              <span className="fav-src-preview">{favoritePreviewText(g.latest)}</span>
            </span>
            <span className="fav-src-count">{g.items.length}</span>
            <ChevronRight size={16} className="fav-src-chevron" />
          </button>
        );
      })}
    </div>
  );
}

/** 聊天模式的来源组显示名（标题「来自 X · N 条」与搜索过滤共用）。 */
export function sourceNameOf(g: FavoriteSourceGroup, conversations: Conversation[], convDisplayLabel: (c: Conversation) => string): string {
  return sourceGroupName(g, (id) => { const c = conversations.find((x) => x.conv_id === id); return c ? convDisplayLabel(c) : undefined; });
}
