import { Video, Image as ImageIcon } from "lucide-react";
import type { ChatMessage } from "../sdk/protocol";
import { passivePreviewSource } from "../download";
import { FileTypeIcon } from "../FileTypeIcon";
import { videoFrameSrc } from "../messageContent";
import { useT } from "../i18n";
import { VideoFrame } from "./VideoFrame";

/**
 * 引用条内的媒体小缩略图（**档 B·被动预览**，对齐 iOS `previewForURL:`）：
 * `gated=true`（被引用者未解门控/本机无原件）→ **只用内嵌 thumb 磨砂、绝不联网拉原件/远端抽帧**，无 thumb 退图标；
 * `gated=false`（已解门控/本机已有）→ 真帧（图片原图 / 视频 poster 或首帧）。文件恒图标。无媒体返回 null。
 */
export function QuoteThumb({ m, gated }: { m?: ChatMessage; gated?: boolean }) {
  const tr = useT();
  if (!m || m.recalledAt) return null;
  if (m.contentType === "image" || m.contentType === "video") {
    const src = passivePreviewSource(!gated, !!m.thumb);
    if (src === "thumb") return <img className="quote-thumb gate-blur" src={m.thumb} alt="" />;
    // 占位图标：用 lucide 矢量（跟随文字色、跨系统一致），与 iOS 引用占位 video.fill/photo.fill 观感对齐——
    // 取代旧 emoji ▶/🖼（依赖各平台 emoji 字体、彩色样式不可控）。
    if (src === "icon") return <span className="quote-thumb quote-thumb-ph">{m.contentType === "video" ? <Video size={18} aria-label={tr("common.video")} /> : <ImageIcon size={18} aria-label={tr("common.image")} />}</span>;
    // original：已解门控才联网取真帧。
    if (m.contentType === "image") return <img className="quote-thumb" src={m.content} alt="" />;
    return m.posterUrl ? <img className="quote-thumb" src={m.posterUrl} alt="" /> : <VideoFrame className="quote-thumb" src={videoFrameSrc(m.content)} thumb={m.thumb} thumbClass="quote-thumb gate-blur" />;
  }
  if (m.contentType === "file") return <FileTypeIcon name={m.fileName || m.content} size={32} className="quote-thumb" />;
  return null;
}

/**
 * 引用兜底图标：被引用原消息**不在本地 messages**（未同步到/已清）时 QuoteThumb 拿不到 `m` 会返回 null，
 * 此时从 `reply_snapshot` 文本推媒体类型显图标——与 iOS「从 reply_snapshot 推 glyph」一致（iOS `IMMediaGlyphForSnippet`）。
 * 快照可能是 wire 形 `[video]`/`[file] 名` 或本端本地化形 `[视频]`/`[文件] 名`，两形都认。文本/聊天记录 → 无图标（返回 null）。
 */
export function QuoteSnapshotIcon({ snapshot }: { snapshot?: string }) {
  const tr = useT();
  const s = snapshot || "";
  if (s === "[video]" || s === "[视频]") return <span className="quote-thumb quote-thumb-ph"><Video size={18} aria-label={tr("common.video")} /></span>;
  if (s === "[image]" || s === "[图片]") return <span className="quote-thumb quote-thumb-ph"><ImageIcon size={18} aria-label={tr("common.image")} /></span>;
  if (s === "[file]" || s === "[文件]" || s.startsWith("[file] ") || s.startsWith("[文件] ")) {
    const name = s.startsWith("[file] ") ? s.slice(7) : s.startsWith("[文件] ") ? s.slice(4) : "";
    return <FileTypeIcon name={name || "file"} size={32} className="quote-thumb" />;
  }
  return null;
}
