/**
 * 媒体气泡的共享规则（与 iOS IMMediaFormat 一一对应，两端排版必须一致）：
 * 时长角标文案、上传进度文案、按原始比例的显示尺寸。
 *
 * 尺寸/时长来自协议的 media_w/media_h/duration（PROTOCOL §4.1），由发送端量出；
 * 未知（0/缺省）时回退方形占位，加载出真实尺寸后再重排。
 */

import { formatFileSize } from "./fileMetadata";
import { LOG_TAG, logger } from "./logging/logger";

/** 气泡最大盒子与下限，与 iOS 的 kIMMediaMaxWidth/Height/MinSide/FallbackSide 保持同值。 */
export const MEDIA_MAX_WIDTH = 240;
export const MEDIA_MAX_HEIGHT = 320;
export const MEDIA_MIN_SIDE = 80;
export const MEDIA_FALLBACK_SIDE = 180;

export interface MediaBox { width: number; height: number }

/** 视频时长（毫秒）→ `0:07` / `1:05` / `1:02:03`；未知返回空串（调用方据此不渲染角标）。 */
export function formatMediaDuration(ms?: number): string {
  if (!Number.isFinite(ms) || ms === undefined || ms <= 0) return "";
  const totalSeconds = Math.ceil(ms / 1000); // 不足 1 秒也显 0:01，不显 0:00
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** 上传进度文案：`3.9 MB / 7.9 MB`；总大小未知回退百分比；未开始显“等待中”。 */
export function formatUploadProgress(sent: number, total: number): string {
  if (!Number.isFinite(sent) || sent <= 0) return "等待中";
  if (!Number.isFinite(total) || total <= 0) return `${Math.round(Math.min(sent, 1) * 100)}%`;
  const done = Math.min(sent, total);
  return `${formatFileSize(done)} / ${formatFileSize(total)}`;
}

/**
 * 按原始像素比例算气泡显示尺寸（CSS px）：等比缩放进 box，**不放大超过 1px/px**（小图保持小图）；
 * 极端长条按短边补到 minSide，但不越出 box；尺寸未知 → 回退方块。
 */
export function mediaDisplaySize(
  pixelW?: number,
  pixelH?: number,
  box: MediaBox = { width: MEDIA_MAX_WIDTH, height: MEDIA_MAX_HEIGHT },
  minSide: number = MEDIA_MIN_SIDE,
): MediaBox {
  if (box.width <= 0 || box.height <= 0) return { width: 0, height: 0 };
  const w = Number(pixelW) || 0;
  const h = Number(pixelH) || 0;
  if (w <= 0 || h <= 0) {
    const side = Math.min(box.width, box.height, MEDIA_FALLBACK_SIDE);
    return { width: side, height: side };
  }
  const k = Math.min(box.width / w, box.height / h, 1);
  const out = { width: Math.round(w * k), height: Math.round(h * k) };
  const shortSide = Math.min(out.width, out.height);
  if (minSide > 0 && shortSide > 0 && shortSide < minSide) {
    const up = minSide / shortSide;
    out.width = Math.min(Math.round(out.width * up), box.width);
    out.height = Math.min(Math.round(out.height * up), box.height);
  }
  return out;
}

export interface MediaMetadata { width: number; height: number; durationMs: number }

const UNKNOWN_METADATA: MediaMetadata = { width: 0, height: 0, durationMs: 0 };

/**
 * 量出待发送文件的像素尺寸与（视频）时长，随消息上行。
 * 浏览器解不了码（如 HEVC）或超时 → 全零，收端回退“加载完再自适应”，**不阻塞发送**。
 */
export async function probeMediaMetadata(file: File): Promise<MediaMetadata> {
  const isVideo = file.type.startsWith("video/");
  if (!isVideo && !file.type.startsWith("image/")) return UNKNOWN_METADATA;
  const meta = await (isVideo ? probeVideo(file) : probeImage(file));
  // 量不到=收端排版回退（无角标、比例未知）的源头，必须留痕；量到了只在 debug 记一笔便于对账。
  const fields = mediaProbeLogFields(file, meta);
  if (isMediaMetadataComplete(isVideo, meta)) logger.debug(LOG_TAG.ui, "media_probe_ok", fields);
  else logger.warn(LOG_TAG.ui, "media_probe_incomplete", fields);
  return meta;
}

/** 尺寸齐全（视频还需时长）才算量到；否则收端只能按未知渲染。 */
export function isMediaMetadataComplete(isVideo: boolean, meta: MediaMetadata): boolean {
  return meta.width > 0 && meta.height > 0 && (!isVideo || meta.durationMs > 0);
}

/**
 * 探测结果 → 日志字段。**只含元数据**（MIME/字节数/量到的值）：
 * 按 LOGGING.md §5，文件名与原始字节一律不进日志。抽成纯函数以便直接断言字段集合。
 */
export function mediaProbeLogFields(file: { type: string; size: number }, meta: MediaMetadata): Record<string, unknown> {
  return { mime: file.type, bytes: file.size, media_w: meta.width, media_h: meta.height, duration_ms: meta.durationMs };
}

function probeVideo(file: File): Promise<MediaMetadata> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (meta: MediaMetadata) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(meta); };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish({
      width: video.videoWidth || 0,
      height: video.videoHeight || 0,
      durationMs: Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 1000) : 0,
    });
    video.onerror = () => finish(UNKNOWN_METADATA);
    window.setTimeout(() => finish(UNKNOWN_METADATA), 8000); // 兜底：绝不因量尺寸卡住发送
    video.src = url;
  });
}

function probeImage(file: File): Promise<MediaMetadata> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    let done = false;
    const finish = (meta: MediaMetadata) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(meta); };
    img.onload = () => finish({ width: img.naturalWidth || 0, height: img.naturalHeight || 0, durationMs: 0 });
    img.onerror = () => finish(UNKNOWN_METADATA);
    window.setTimeout(() => finish(UNKNOWN_METADATA), 8000);
    img.src = url;
  });
}
