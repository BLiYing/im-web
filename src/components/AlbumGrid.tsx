import { chunkedTaskFor } from "../sdk/chunkedUpload";
import type { ChatMessage } from "../sdk/protocol";
import { albumRowPattern } from "../album";
import { formatMediaDuration } from "../media";
import { formatFileSize } from "../fileMetadata";
import { videoFrameSrc } from "../messageContent";
import { useT } from "../i18n";

/** 相册宫格（M4+）：同 group_id 的多图/视频合并为一个 Telegram 式宫格。
 *  发送中（convSeq=0）的格子压暗 + 转圈；失败标 "!"；右键单格 → 该条成员消息的菜单（单张引用/转发/撤回）。 */
export function AlbumGrid({ members, timeLabel, progress, gateFor, expiredFor, onOpen, onMenu, onMediaError, selectMode, isSelected, onToggleTile }: {
  members: ChatMessage[];
  timeLabel: string;
  progress: Record<string, { sent: number; total: number }>;
  gateFor: (m: ChatMessage) => boolean; // 该格是否门控（收到的未下载图/视频）：档 A，逐格独立判定
  expiredFor?: (m: ChatMessage) => boolean; // 该格是否已失效（服务端已清理）：失效则不给 ↓、只留磨砂 dim
  onOpen: (m: ChatMessage) => void;
  onMenu: (e: React.MouseEvent, m: ChatMessage) => void;
  onMediaError?: (m: ChatMessage) => void; // 原件 <img>/<video> 加载失败 → 复验 404 落失效标记（首屏即显失效）
  selectMode?: boolean; // 多选态（2a）：每格右上角显勾选框，点格=切换该格选中，不进查看器
  isSelected?: (m: ChatMessage) => boolean; // 该格是否已选（conv_seq ∈ 选择集）
  onToggleTile?: (m: ChatMessage) => void; // 切换该格选中
}) {
  const tr = useT();
  const W = 240, GAP = 2;
  const pattern = albumRowPattern(members.length);
  let idx = 0;
  const rows = pattern.map((cols) => members.slice(idx, (idx += cols)));
  return (
    <div className="album-grid" style={{ width: W }}>
      {rows.map((row, ri) => {
        const tileW = (W - (row.length - 1) * GAP) / row.length;
        const tileH = row.length === 1 ? 150 : tileW;
        return (
          <div className="album-row" key={ri} style={{ gap: GAP, marginTop: ri === 0 ? 0 : GAP }}>
            {row.map((m) => {
              const up = progress[m.clientMsgId ?? ""];
              const task = chunkedTaskFor(m.clientMsgId ?? "");
              const durText = m.contentType === "video" ? formatMediaDuration(m.duration) : "";
              // 逐格门控（档 A，对齐 iOS IMAlbumCell）：未下载格**只显内嵌 thumb 磨砂 + 中心 ↓ + 尺寸角标，绝不拉原图/原视频**；
              // 点门控格=就地下载（解门控），非进查看器（铁律③手动优先）。
              const gated = gateFor(m);
              const sizeText = formatFileSize(m.fileSize);
              // 多选：该格可选=已入库(convSeq>0)未撤回；点格切换选中、不进查看器。
              const tileSelectable = !!selectMode && m.convSeq > 0 && !m.recalledAt;
              const tileOn = tileSelectable && !!isSelected && isSelected(m);
              return (
              <div key={m.clientMsgId ?? m.serverMsgId ?? m.convSeq} className={`album-tile${selectMode ? " selecting" : ""}`}
                data-album-seq={m.convSeq || undefined}
                style={{ width: row.length === 1 ? W : tileW, height: tileH }}
                onClick={(e) => { if (selectMode) { e.stopPropagation(); if (tileSelectable) { onToggleTile?.(m); } return; } onOpen(m); }}
                onContextMenu={(e) => { if (selectMode) { e.preventDefault(); return; } onMenu(e, m); }}>
                {gated
                  ? (m.thumb ? <img className="gate-blur" src={m.thumb} alt={tr("fav.file.not_downloaded")} /> : <span className="gate-empty" />)
                  : m.contentType === "video"
                    ? (m.posterUrl ? <img src={m.posterUrl} alt="" onError={() => onMediaError?.(m)} /> : <video src={videoFrameSrc(m.content)} muted preload="metadata" onError={() => onMediaError?.(m)} />)
                    : <img src={m.content} alt="" onError={() => onMediaError?.(m)} />}
                {gated
                  ? (expiredFor?.(m) ? null : <span className="album-dl">↓</span>) // 失效格不给 ↓（无从重下），只留磨砂 dim
                  : m.contentType === "video" && !(m.status === "sending" && m.convSeq === 0) && <span className="play-badge">▶</span>}
                {/* 角标：门控显「尺寸(·时长)」；否则仅时长（上传中也显示——宫格进度在中心，左上角是空的，与 iOS 一致）。 */}
                {gated
                  ? ((sizeText || durText) && <span className="album-duration">{[sizeText, durText].filter(Boolean).join(" · ")}</span>)
                  : (durText && <span className="album-duration">{durText}</span>)}
                {m.status === "sending" && m.convSeq === 0 && (
                  <span className="album-tile-dim">
                    {/* 分片任务：中心 ⏸/↑（点格子暂停/继续）；小文件（不可暂停）保留转圈。 */}
                    {up && task ? <span className="album-pause">{task.paused ? "↑" : "⏸"}</span> : <span className="album-spinner" />}
                  </span>
                )}
                {/* 格内 ❗ 只表达「这一格上传/发送失败」。**被服务端拒收（有 note）时不显示**——
                    那是整条消息的事，已由宫格左侧红❗+下方系统行表达，逐格再标一遍是噪声。
                    与 iOS 同语义：iOS 格内 ❗ 由 IMUploadProgress.failed 驱动，拒收时上传早已成功故不显示。 */}
                {m.status === "failed" && !m.note && <span className="album-tile-dim"><span className="album-fail">!</span></span>}
                {/* 多选逐格勾选框（2a）：右上角圆圈，选中显对勾。 */}
                {tileSelectable && <span className={`album-sel${tileOn ? " on" : ""}`}>{tileOn ? "✓" : ""}</span>}
              </div>
              );
            })}
          </div>
        );
      })}
      <span className="album-meta">{timeLabel}</span>
    </div>
  );
}
