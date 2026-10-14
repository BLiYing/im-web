import { Ban, OctagonX } from "lucide-react";
import { useT } from "../i18n";

// 「已失效」字形，**逐面对齐 Android**（`Lucide.Ban` / `Lucide.OctagonX`）：
//   tile  = ⊘ 圆圈斜杠（宫格小格：相册 / 媒体库 / 详情页媒体页签；Android `AlbumTileGate`）
//   cover = 八角 ✕（单图/视频气泡覆盖层 `ExpiredCover`、查看器失效页 `ExpiredViewerPage`）
// 不用文本「⊘」：各平台字体渲染不一，且与另两端不是同一个图。
export function ExpiredGlyph({ size = 22, kind = "tile" }: { size?: number; kind?: "tile" | "cover" }) {
  const Icon = kind === "tile" ? Ban : OctagonX;
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />;
}

// 单图/视频气泡的「已失效」覆盖层（对齐 iOS IMMediaPlaceholder.expiredOverlay / Android ExpiredCover）：
// 整块压暗 + 中心八角 ✕ + 其下一行文案（「图片已失效」/「视频已失效」）。终态：不可点（pointer-events:none，点击穿透）。
export function ExpiredCover({ caption }: { caption: string }) {
  const tr = useT();
  return (
    <>
      <span className="tile-expired-dim" />
      <span className="play-badge expired expired-cover" title={tr("media.placeholder.expired")}>
        <span className="expired-glyph"><ExpiredGlyph size={28} kind="cover" /></span>
        <span className="expired-cap">{caption}</span>
      </span>
    </>
  );
}

// 查看器里的失效页（对齐 Android `ExpiredViewerPage`：黑底 + 八角 ✕ 40 + 一行 15px 文案；图片 / 视频同一页）。
export function ExpiredViewerPage({ caption }: { caption: string }) {
  return (
    <div className="viewer-expired" onClick={(e) => e.stopPropagation()}>
      <ExpiredGlyph size={40} kind="cover" />
      <p>{caption}</p>
    </div>
  );
}
