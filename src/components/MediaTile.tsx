import type { ChatMessage } from "../sdk/protocol";
import type { DownloadState } from "../download";
import { formatFileSize } from "../fileMetadata";
import { formatMediaDuration } from "../media";
import { videoFrameSrc } from "../messageContent";
import { useT } from "../i18n";
import { VideoFrame } from "./VideoFrame";
import { ExpiredGlyph } from "./ExpiredCover";
import { useProbeExpiry } from "../ChatActionsContext";
import { useEffect } from "react";

// 门控媒体格子（图片/视频缩略）：会话媒体库与资料页「媒体」页签共用。
// 两处此前 ~15 行重复，差异仅在 5 处，收进 variant：
//   - gallery（媒体库蒙层网格）：<div>、就绪视频用 play-badge。
//   - detail（资料页媒体页签）  ：<button>、就绪视频用 detail-media-play（失效格与 gallery 一致：压暗 + ⊘，不显尺寸/时长，对齐 iOS/Android）。
// 未下载/就绪的缩略渲染、尺寸角标、title 提示、右键=文件菜单在两 variant 间逐字一致。
// key 由调用方 .map 提供（gallery 与 detail 统一用 msgKey），本组件不设 key。
type Variant = "gallery" | "detail";
const SPEC: Record<Variant, { tag: "div" | "button"; cls: string; playBadge: string }> = {
  gallery: { tag: "div", cls: "gallery-item", playBadge: "play-badge" },
  detail: { tag: "button", cls: "detail-media-tile", playBadge: "detail-media-play" },
};

export function MediaTile({ variant, m, gate, onClick, onMenu, onMediaError }: {
  variant: Variant;
  m: ChatMessage;
  gate: DownloadState | undefined; // 门控态：undefined=就绪直显；否则未下载/失效
  onClick: (m: ChatMessage) => void; // 就绪=打开查看器；门控=就地下载（gate 逻辑由调用方按 variant 决定）
  onMenu: (e: React.MouseEvent, m: ChatMessage) => void;
  onMediaError: (m: ChatMessage) => void;
}) {
  const tr = useT();
  const probe = useProbeExpiry();
  // 进页就探一次是否已被服务端清理：门控格 / 只拉封面的视频格都不会请求原件，不探就要等用户点开才显失效。
  useEffect(() => { if (m.content) probe?.(m); }, [m.content, probe]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = SPEC[variant];
  const sizeText = formatFileSize(m.fileSize);
  const title = gate ? (sizeText ? tr("chat.file.size_tap_download", { size: sizeText }) : tr("media.download.tap_to_download")) : undefined;
  const showSize = !!gate && !!sizeText && gate.phase !== "expired";
  const Tag = s.tag;
  return (
    <Tag className={s.cls}
      onClick={() => onClick(m)}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e, m); }}
      title={title}>
      {gate
        ? (m.thumb ? <img className="gate-blur" src={m.thumb} alt={tr("fav.file.not_downloaded")} /> : <span className="gate-empty" />)
        : (m.contentType === "video"
            ? (m.posterUrl ? <img src={m.posterUrl} alt="" onError={() => onMediaError(m)} /> : <VideoFrame src={videoFrameSrc(m.content)} thumb={m.thumb} onError={() => onMediaError(m)} />)
            : <img src={m.content} alt="" onError={() => onMediaError(m)} />)}
      {gate
        ? (gate.phase === "expired" ? <><span className="tile-expired-dim" /><span className="play-badge expired" role="img" title={tr("media.placeholder.expired")} aria-label={tr("media.placeholder.expired")}><ExpiredGlyph size={22} /></span></> : <span className="detail-media-dl">↓</span>)
        : m.contentType === "video" && <span className={s.playBadge}>▶</span>}
      {showSize && <span className="detail-media-size">{sizeText}</span>}
      {m.contentType === "video" && formatMediaDuration(m.duration) && gate?.phase !== "expired" && (  /* 时长恒显：未下载也预显（元数据发送时即知，详情页+收藏一致） */
        <span className="detail-media-dur">{formatMediaDuration(m.duration)}</span>
      )}
    </Tag>
  );
}
