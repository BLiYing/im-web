import { downloadGlyph, downloadFraction, type DownloadState } from "../download";

/**
 * 文件门控圆形图标（对齐 iOS IMChatDetailViewController 的 `_disc`/`_ring`）：固定 36px 圆底 + 白色字形，
 * 聊天气泡与详情文件列表共用。**下载中叠加环形进度**——去掉了原来的底部线性进度条，图标槽位恒定，
 * 状态切换（↓→✕）不再撑高卡片 / 下移图标（修下载抖动）。
 * 未下载=accent 圆底 ↓ / 下载中=中性圆底 + accent 进度环 + ✕ / 失败=danger 圆底 ↻ / 已失效=中性圆底 ⊘。
 */
export function FileGateIcon({ state }: { state: DownloadState }) {
  const glyph = downloadGlyph(state) ?? "⊘";
  const cls = state.phase === "downloading" ? "downloading"
            : state.phase === "failed" ? "failed"
            : state.phase === "expired" ? "expired" : "";
  const R = 16, C = 2 * Math.PI * R; // 半径 16 → 周长，驱动 stroke-dashoffset
  return (
    <span className={`msg-file-dl ${cls}`.trim()}>
      {state.phase === "downloading" && (
        <svg className="dl-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle className="dl-ring-track" cx="18" cy="18" r={R} />
          <circle className="dl-ring-bar" cx="18" cy="18" r={R}
                  style={{ strokeDasharray: C, strokeDashoffset: C * (1 - downloadFraction(state)) }} />
        </svg>
      )}
      <span className="dl-glyph">{glyph}</span>
    </span>
  );
}
