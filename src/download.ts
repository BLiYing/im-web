// 自动下载策略 + 下载门控（M4-7，Web 端映射）。
//
// 契约与后端 `internal/downloadsettings` / iOS `IMDownloadSettings` 逐字段对齐；语义由三端各自解释，
// 服务端只存原始 JSON + 单调版本（任一端改 → bump version → capabilities_update → 其它端重拉）。
//
// **Web 端的诚实差异**（见 docs/DOWNLOAD_UX_SKETCH.html §07）：浏览器无法可靠区分"移动数据 / Wi-Fi"，
// 桌面也没有流量焦虑 —— 所以 Web **只读取并遵守 Wi-Fi 这一档**，"移动数据"档在 Web 不生效；
// 用户在 Web 改的策略仍会同步回移动端（改的就是 Wi-Fi 档）。Web 始终提供手动下载。

/** 单一媒体类别（图片/视频/文件）在某网络下的规则。maxBytes=0 表示"手动"（不自动下）。 */
export interface CategoryRule {
  single: boolean;
  group: boolean;
  max_bytes: number;
}

/** 某网络类型下的整套策略。 */
export interface NetworkPolicy {
  enabled: boolean;
  image: CategoryRule;
  video: CategoryRule;
  file: CategoryRule;
}

export interface DownloadSettings {
  cellular: NetworkPolicy;
  wifi: NetworkPolicy;
}

const MB = 1024 * 1024;
/** 大小上限允许的最大值（1.5 GiB，对齐 Telegram 滑块右端 + 后端 MaxAutoBytes）。 */
export const MAX_AUTO_BYTES = 1536 * MB;

/** 出厂默认：移动数据 中档（视频 10MB / 文件 1MB）、Wi-Fi 高档（视频 15MB / 文件 3MB）；图片恒自动。 */
export function defaultDownloadSettings(): DownloadSettings {
  const img = (): CategoryRule => ({ single: true, group: true, max_bytes: 0 });
  return {
    cellular: {
      enabled: true,
      image: img(),
      video: { single: true, group: true, max_bytes: 10 * MB },
      file: { single: true, group: true, max_bytes: 1 * MB },
    },
    wifi: {
      enabled: true,
      image: img(),
      video: { single: true, group: true, max_bytes: 15 * MB },
      file: { single: true, group: true, max_bytes: 3 * MB },
    },
  };
}

function clampBytes(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), MAX_AUTO_BYTES);
}

function parseRule(raw: unknown, forceNoLimit: boolean): CategoryRule {
  const o = (raw ?? {}) as Partial<CategoryRule>;
  return {
    single: o.single !== false, // 缺省视为开（与后端默认一致）
    group: o.group !== false,
    max_bytes: forceNoLimit ? 0 : clampBytes(Number(o.max_bytes ?? 0)),
  };
}

function parsePolicy(raw: unknown, fallback: NetworkPolicy): NetworkPolicy {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled !== false,
    image: parseRule(o.image, true), // 图片无大小概念，上限恒 0
    video: parseRule(o.video, false),
    file: parseRule(o.file, false),
  };
}

/** 解析 `GET /api/v1/download-settings` 的 `settings` 块；缺字段一律回退默认，绝不抛。 */
export function parseDownloadSettings(raw: unknown): DownloadSettings {
  const d = defaultDownloadSettings();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  return {
    cellular: parsePolicy(o.cellular, d.cellular),
    wifi: parsePolicy(o.wifi, d.wifi),
  };
}

export type MediaKind = "image" | "video" | "file";

/**
 * 是否应自动下载（与 iOS `IMShouldAutoDownload` 同一决策矩阵）。
 * 规则：网络总开关关→否；该类别的单/群开关关→否；图片→是（无大小闸）；
 *      视频/文件→仅当 `sizeBytes>0 且 <= max_bytes`（max_bytes=0 即"手动"，恒否；
 *      **大小未知也保守判否**，让用户点 ↓，避免误拉大文件）。
 * Web 恒用 Wi-Fi 档（浏览器分不清网络类型，见文件头）。
 */
export function shouldAutoDownload(
  settings: DownloadSettings | null | undefined,
  kind: string,
  sizeBytes: number,
  isGroup: boolean,
): boolean {
  const s = settings ?? defaultDownloadSettings();
  const policy = s.wifi;
  if (!policy.enabled) return false;
  let rule: CategoryRule;
  if (kind === "image") rule = policy.image;
  else if (kind === "video") rule = policy.video;
  else if (kind === "file") rule = policy.file;
  else return true; // 语音/贴纸等体积极小的类型不进阈值体系，恒自动（草图 §08-07）
  if (!(isGroup ? rule.group : rule.single)) return false;
  if (kind === "image") return true;
  if (rule.max_bytes <= 0) return false;
  return sizeBytes > 0 && sizeBytes <= rule.max_bytes;
}

/** 快捷档位（草图 §06）：滑块是快捷入口，单类页才是最终真相；两者不一致时显示"自定义"。 */
export type SpeedTier = "low" | "medium" | "high" | "custom";

/** 档位 → 该档的视频/文件上限（图片恒自动）。低档=视频/文件都手动。 */
export function tierLimits(tier: Exclude<SpeedTier, "custom">): { video: number; file: number } {
  if (tier === "low") return { video: 0, file: 0 };
  if (tier === "medium") return { video: 10 * MB, file: 1 * MB };
  return { video: 15 * MB, file: 3 * MB };
}

/** 反推当前策略落在哪个快捷档；对不上任何预设即"自定义"。 */
export function tierOfPolicy(p: NetworkPolicy): SpeedTier {
  for (const t of ["low", "medium", "high"] as const) {
    const l = tierLimits(t);
    if (p.video.max_bytes === l.video && p.file.max_bytes === l.file) return t;
  }
  return "custom";
}

/** 把整档套用到策略（写的是单类页的大小上限，与 iOS/Telegram 一致）。 */
export function applyTier(p: NetworkPolicy, tier: Exclude<SpeedTier, "custom">): NetworkPolicy {
  const l = tierLimits(tier);
  return {
    ...p,
    video: { ...p.video, max_bytes: l.video },
    file: { ...p.file, max_bytes: l.file },
  };
}

/** 下载状态机（与 iOS `IMDownloadProgress` 五态镜像）。 */
export type DownloadPhase = "notStarted" | "downloading" | "failed" | "expired" | "done";

export interface DownloadState {
  phase: DownloadPhase;
  received: number;
  total: number;
}

/** 0..1 进度；总大小未知时回退 0（环形/条形进度显示不出百分比，只能显"在动"）。 */
export function downloadFraction(s: DownloadState): number {
  if (s.total <= 0) return 0;
  return Math.max(0, Math.min(1, s.received / s.total));
}

/**
 * 门控态下卡片上的中心符号（与 iOS `IMDownloadCenterSymbolName` 镜像）：
 * 未下载 ↓ / 下载中 ✕（Web 无分片续传，只能取消重来，不给 ⏸）/ 失败 ↻ / 已失效·就绪 无按钮。
 */
export function downloadGlyph(s: DownloadState | undefined): string | null {
  if (!s) return "↓";
  switch (s.phase) {
    case "notStarted": return "↓";
    case "downloading": return "✕";
    case "failed": return "↻";
    case "expired": return null; // 服务端已清理：无从重试
    case "done": return null;    // 完成即止，绝不自动打开
  }
}

/**
 * 档 B 被动预览的三态取图决策（引用条 / 会话媒体库宫格；对齐 iOS `previewForURL:` 优先级）：
 * `resolved`（已解门控 / 本机已有原件）→ `"original"`（真帧）；否则有 thumb → `"thumb"`（磨砂缩略）；
 * 都没有 → `"icon"`（媒体类型图标 / 中性底）。
 * **契约**：`"thumb"`/`"icon"` 分支**绝不为预览联网**——不得加载原件、poster 或远端抽帧（与 iOS 档 B 一致）。
 */
export type PreviewSource = "original" | "thumb" | "icon";
export function passivePreviewSource(resolved: boolean, hasThumb: boolean): PreviewSource {
  if (resolved) return "original";
  return hasThumb ? "thumb" : "icon";
}

/** 卡片角标 / 文件条第二行文案（与 iOS displayText / fileLineText 对齐）。
 *  `kind` 仅用于「已失效」的类型化文案（图片/视频/文件），缺省 → "文件已失效"（兼容既有调用与测试）。 */
export function downloadText(s: DownloadState | undefined, sizeText: string, kind?: MediaKind): string {
  if (!s || s.phase === "notStarted") return sizeText;
  switch (s.phase) {
    case "downloading": return `${Math.round(downloadFraction(s) * 100)}%`;
    case "failed": return "下载失败，点击重试";
    case "expired": return kind === "image" ? "图片已失效" : kind === "video" ? "视频已失效" : "文件已失效";
    case "done": return sizeText;
  }
}
