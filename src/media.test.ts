import { describe, expect, it } from "vitest";

import { diagnosticEntries } from "./logging/logger";
import {
  MEDIA_FALLBACK_SIDE,
  formatMediaDuration,
  formatUploadProgress,
  isMediaMetadataComplete,
  mediaDisplaySize,
  mediaProbeLogFields,
  probeMediaMetadata,
} from "./media";

// 与 iOS IMMediaFormatTests 同口径：两端媒体气泡的排版/文案必须一致。
describe("formatMediaDuration", () => {
  it("按 mm:ss 显示，≥1 小时才带小时段", () => {
    expect(formatMediaDuration(7000)).toBe("0:07");
    expect(formatMediaDuration(65000)).toBe("1:05");
    expect(formatMediaDuration(600000)).toBe("10:00");
    expect(formatMediaDuration(3723000)).toBe("1:02:03");
  });

  it("不足 1 秒向上取整，未知时长不渲染角标", () => {
    expect(formatMediaDuration(400)).toBe("0:01");
    expect(formatMediaDuration(0)).toBe("");
    expect(formatMediaDuration(undefined)).toBe("");
  });
});

describe("formatUploadProgress", () => {
  it("显示已传 / 总大小", () => {
    expect(formatUploadProgress(4124719, 8249438)).toBe("3.9 MB / 7.9 MB");
    expect(formatUploadProgress(8249438, 8249438)).toBe("7.9 MB / 7.9 MB");
  });

  it("未开始显等待中，已传超过总数时夹住", () => {
    expect(formatUploadProgress(0, 8249438)).toBe("等待中");
    expect(formatUploadProgress(99999, 1024)).toBe("1 KB / 1 KB");
  });
});

describe("mediaDisplaySize", () => {
  it("保持原始比例并夹进盒子", () => {
    expect(mediaDisplaySize(4032, 3024)).toEqual({ width: 240, height: 180 }); // 4:3 横图顶宽
    expect(mediaDisplaySize(1080, 1920)).toEqual({ width: 180, height: 320 }); // 9:16 竖视频顶高
  });

  it("小图不放大（避免糊）", () => {
    expect(mediaDisplaySize(100, 90)).toEqual({ width: 100, height: 90 });
  });

  it("极端长条把短边补到下限且不越出盒子", () => {
    const out = mediaDisplaySize(4000, 200);
    expect(out.width).toBeLessThanOrEqual(240);
    expect(out.height).toBeGreaterThanOrEqual(80);
  });

  it("尺寸未知回退方形占位", () => {
    expect(mediaDisplaySize(0, 0)).toEqual({ width: MEDIA_FALLBACK_SIDE, height: MEDIA_FALLBACK_SIDE });
    expect(mediaDisplaySize(undefined, undefined)).toEqual({ width: MEDIA_FALLBACK_SIDE, height: MEDIA_FALLBACK_SIDE });
  });
});

describe("媒体探测日志", () => {
  it("只记元数据：文件名与内容一律不进日志（LOGGING.md §5）", () => {
    const fields = mediaProbeLogFields(
      { type: "image/jpeg", size: 993045 },
      { width: 3024, height: 4032, durationMs: 0 },
    );
    expect(Object.keys(fields).sort()).toEqual(["bytes", "duration_ms", "media_h", "media_w", "mime"]);
    expect(fields).toEqual({ mime: "image/jpeg", bytes: 993045, media_w: 3024, media_h: 4032, duration_ms: 0 });
  });

  it("量不到尺寸/时长才算不完整（决定 WARN 还是 debug）", () => {
    expect(isMediaMetadataComplete(false, { width: 100, height: 80, durationMs: 0 })).toBe(true);
    expect(isMediaMetadataComplete(true, { width: 1080, height: 1920, durationMs: 65000 })).toBe(true);
    expect(isMediaMetadataComplete(true, { width: 1080, height: 1920, durationMs: 0 })).toBe(false); // 视频缺时长
    expect(isMediaMetadataComplete(false, { width: 0, height: 0, durationMs: 0 })).toBe(false); // 解不了码
  });

  it("非图片/视频直接返回未知，不产生探测日志、不阻塞发送", async () => {
    const before = diagnosticEntries().length;
    const meta = await probeMediaMetadata(new File(["x"], "a.pdf", { type: "application/pdf" }));
    expect(meta).toEqual({ width: 0, height: 0, durationMs: 0 });
    expect(diagnosticEntries().slice(before).filter((e) => e.event.startsWith("media_probe"))).toHaveLength(0);
  });
});
