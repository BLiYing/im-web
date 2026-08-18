import type { ReactNode } from "react";
import type { ChatMessage } from "../sdk/protocol";
import type { DownloadState } from "../download";
import { formatFileSize } from "../fileMetadata";
import { videoFrameSrc } from "../messageContent";

// 门控媒体格子（图片/视频缩略）：会话媒体库与资料页「媒体」页签共用。
// 两处此前 ~15 行重复，差异仅在 5 处，收进 variant：
//   - gallery（媒体库蒙层网格）：<div>、失效格显 ⊘ 徽标、失效格不显尺寸、就绪视频用 play-badge。
//   - detail（资料页媒体页签）  ：<button>、失效格无徽标、失效格仍显尺寸、就绪视频用 detail-media-play。
// 未下载/就绪的缩略渲染、尺寸角标、title 提示、右键=文件菜单在两 variant 间逐字一致。
// key 由调用方 .map 提供（gallery 用 mediaIdentity、detail 用 serverMsgId||convSeq），本组件不设 key。
type Variant = "gallery" | "detail";
const SPEC: Record<Variant, { tag: "div" | "button"; cls: string; playBadge: string; expiredBadge: ReactNode; sizeWhenExpired: boolean }> = {
  gallery: { tag: "div", cls: "gallery-item", playBadge: "play-badge", expiredBadge: <span className="play-badge expired" title="已失效">⊘</span>, sizeWhenExpired: false },
  detail: { tag: "button", cls: "detail-media-tile", playBadge: "detail-media-play", expiredBadge: null, sizeWhenExpired: true },
};

export function MediaTile({ variant, m, gate, onClick, onMenu, onMediaError }: {
  variant: Variant;
  m: ChatMessage;
  gate: DownloadState | undefined; // 门控态：undefined=就绪直显；否则未下载/失效
  onClick: (m: ChatMessage) => void; // 就绪=打开查看器；门控=就地下载（gate 逻辑由调用方按 variant 决定）
  onMenu: (e: React.MouseEvent, m: ChatMessage) => void;
  onMediaError: (m: ChatMessage) => void;
}) {
  const s = SPEC[variant];
  const sizeText = formatFileSize(m.fileSize);
  const title = gate ? (sizeText ? `${sizeText} · 点击下载` : "点击下载") : undefined;
  const showSize = !!gate && !!sizeText && (s.sizeWhenExpired || gate.phase !== "expired");
  const Tag = s.tag;
  return (
    <Tag className={s.cls}
      onClick={() => onClick(m)}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e, m); }}
      title={title}>
      {gate
        ? (m.thumb ? <img className="gate-blur" src={m.thumb} alt="未下载" /> : <span className="gate-empty" />)
        : (m.contentType === "video"
            ? (m.posterUrl ? <img src={m.posterUrl} alt="" onError={() => onMediaError(m)} /> : <video src={videoFrameSrc(m.content)} muted preload="metadata" onError={() => onMediaError(m)} />)
            : <img src={m.content} alt="" onError={() => onMediaError(m)} />)}
      {gate
        ? (gate.phase === "expired" ? s.expiredBadge : <span className="detail-media-dl">↓</span>)
        : m.contentType === "video" && <span className={s.playBadge}>▶</span>}
      {showSize && <span className="detail-media-size">{sizeText}</span>}
    </Tag>
  );
}
