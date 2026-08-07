import { describe, it, expect } from "vitest";
import {
  defaultDownloadSettings,
  parseDownloadSettings,
  shouldAutoDownload,
  tierLimits,
  tierOfPolicy,
  applyTier,
  downloadFraction,
  downloadGlyph,
  downloadText,
  MAX_AUTO_BYTES,
  passivePreviewSource,
  type DownloadState,
} from "./download";

const MB = 1024 * 1024;

describe("默认值（与后端 downloadsettings.Defaults / iOS 对齐）", () => {
  it("移动数据中档、Wi-Fi 高档、图片恒自动", () => {
    const d = defaultDownloadSettings();
    expect(d.cellular.enabled).toBe(true);
    expect(d.cellular.video.max_bytes).toBe(10 * MB);
    expect(d.cellular.file.max_bytes).toBe(1 * MB);
    expect(d.wifi.video.max_bytes).toBe(15 * MB);
    expect(d.wifi.file.max_bytes).toBe(3 * MB);
    expect(d.wifi.image.max_bytes).toBe(0); // 图片无大小闸
    expect(d.wifi.image.single && d.wifi.image.group).toBe(true);
  });
});

describe("parseDownloadSettings 容错", () => {
  it("空/垃圾输入回退默认", () => {
    expect(parseDownloadSettings(null)).toEqual(defaultDownloadSettings());
    expect(parseDownloadSettings("nope" as unknown)).toEqual(defaultDownloadSettings());
  });

  it("上限夹到 [0, 1.5GiB]，负数视为 0（手动）", () => {
    const s = parseDownloadSettings({
      wifi: { enabled: true, image: {}, video: { max_bytes: -5 }, file: { max_bytes: 99 * 1024 * MB } },
    });
    expect(s.wifi.video.max_bytes).toBe(0);
    expect(s.wifi.file.max_bytes).toBe(MAX_AUTO_BYTES);
  });

  it("图片上限恒被规整为 0（后端也这么规整，两端不会打架）", () => {
    const s = parseDownloadSettings({ wifi: { image: { max_bytes: 999 } } });
    expect(s.wifi.image.max_bytes).toBe(0);
  });

  it("显式 false 才关；缺字段视为开", () => {
    const s = parseDownloadSettings({ wifi: { enabled: false, video: { group: false } } });
    expect(s.wifi.enabled).toBe(false);
    expect(s.wifi.video.group).toBe(false);
    expect(s.wifi.video.single).toBe(true);
  });
});

describe("shouldAutoDownload 决策矩阵（Web 恒吃 Wi-Fi 档）", () => {
  const s = defaultDownloadSettings();

  it("图片无大小闸，恒自动", () => {
    expect(shouldAutoDownload(s, "image", 50 * MB, false)).toBe(true);
    expect(shouldAutoDownload(s, "image", 0, true)).toBe(true);
  });

  it("视频/文件按上限放行", () => {
    expect(shouldAutoDownload(s, "video", 10 * MB, false)).toBe(true);   // ≤15MB
    expect(shouldAutoDownload(s, "video", 20 * MB, false)).toBe(false);  // 超上限 → 手动
    expect(shouldAutoDownload(s, "file", 1 * MB, false)).toBe(true);     // ≤3MB
    expect(shouldAutoDownload(s, "file", 9 * MB, false)).toBe(false);
  });

  it("大小未知（0）保守判否，避免弱网误拉大文件", () => {
    expect(shouldAutoDownload(s, "video", 0, false)).toBe(false);
    expect(shouldAutoDownload(s, "file", 0, false)).toBe(false);
  });

  it("总开关关 → 全部手动", () => {
    const off = defaultDownloadSettings();
    off.wifi.enabled = false;
    expect(shouldAutoDownload(off, "image", 1, false)).toBe(false);
    expect(shouldAutoDownload(off, "video", 1, false)).toBe(false);
  });

  it("单聊/群聊分档独立生效", () => {
    const g = defaultDownloadSettings();
    g.wifi.video.group = false;
    expect(shouldAutoDownload(g, "video", 1 * MB, true)).toBe(false);
    expect(shouldAutoDownload(g, "video", 1 * MB, false)).toBe(true);
  });

  it("max_bytes=0 即「手动」，多大都不自动", () => {
    const manual = defaultDownloadSettings();
    manual.wifi.video.max_bytes = 0;
    expect(shouldAutoDownload(manual, "video", 1, false)).toBe(false);
  });

  it("Web 只吃 Wi-Fi 档：改 cellular 不影响判定", () => {
    const c = defaultDownloadSettings();
    c.cellular.enabled = false;
    c.cellular.video.max_bytes = 0;
    expect(shouldAutoDownload(c, "video", 10 * MB, false)).toBe(true);
  });

  it("未知类型（语音/贴纸）不进阈值体系，恒自动", () => {
    expect(shouldAutoDownload(s, "audio", 999 * MB, false)).toBe(true);
  });

  it("settings 为空时用默认，不抛", () => {
    expect(shouldAutoDownload(null, "video", 1 * MB, false)).toBe(true);
  });
});

describe("快捷档位（低/中/高 ↔ 单类页上限）", () => {
  it("低档=视频/文件都手动", () => {
    expect(tierLimits("low")).toEqual({ video: 0, file: 0 });
  });

  it("档位可往返：applyTier 后 tierOfPolicy 回到同一档", () => {
    const p = defaultDownloadSettings().wifi;
    for (const t of ["low", "medium", "high"] as const) {
      expect(tierOfPolicy(applyTier(p, t))).toBe(t);
    }
  });

  it("手改上限后回落「自定义」（草图 §06：单类页才是最终真相）", () => {
    const p = applyTier(defaultDownloadSettings().wifi, "high");
    p.video.max_bytes = 7 * MB;
    expect(tierOfPolicy(p)).toBe("custom");
  });

  it("套档只动大小上限，不动单聊/群聊开关", () => {
    const p = defaultDownloadSettings().wifi;
    p.video.group = false;
    expect(applyTier(p, "low").video.group).toBe(false);
  });
});

describe("下载状态机呈现（与 iOS 镜像）", () => {
  const st = (phase: DownloadState["phase"], received = 0, total = 0): DownloadState =>
    ({ phase, received, total });

  it("进度分数在 [0,1] 内，总大小未知回退 0", () => {
    expect(downloadFraction(st("downloading", 50, 200))).toBeCloseTo(0.25);
    expect(downloadFraction(st("downloading", 50, 0))).toBe(0);
    expect(downloadFraction(st("downloading", 999, 100))).toBe(1);
  });

  it("中心符号分态；就绪与已失效都不给按钮", () => {
    expect(downloadGlyph(undefined)).toBe("↓");
    expect(downloadGlyph(st("notStarted"))).toBe("↓");
    expect(downloadGlyph(st("downloading"))).toBe("✕");
    expect(downloadGlyph(st("failed"))).toBe("↻");
    expect(downloadGlyph(st("expired"))).toBeNull();
    expect(downloadGlyph(st("done"))).toBeNull(); // 完成即止，绝不自动打开
  });

  it("文案分态：未下载显尺寸、下载中显百分比、失败分因", () => {
    expect(downloadText(undefined, "2.4 MB")).toBe("2.4 MB");
    expect(downloadText(st("notStarted"), "2.4 MB")).toBe("2.4 MB");
    expect(downloadText(st("downloading", 1, 2), "2.4 MB")).toBe("50%");
    expect(downloadText(st("failed"), "2.4 MB")).toBe("下载失败，点击重试");
    expect(downloadText(st("expired"), "2.4 MB")).toBe("文件已失效");
  });
});

describe("档 B 被动预览取图（引用条 / 会话媒体库；对齐 iOS previewForURL）", () => {
  it("已解门控/本地已有 → 真帧，无视有无 thumb", () => {
    expect(passivePreviewSource(true, true)).toBe("original");
    expect(passivePreviewSource(true, false)).toBe("original");
  });
  it("未解门控但有 thumb → 磨砂缩略（不联网）", () => {
    expect(passivePreviewSource(false, true)).toBe("thumb");
  });
  it("未解门控且无 thumb → 图标兜底（不联网）", () => {
    expect(passivePreviewSource(false, false)).toBe("icon");
  });
});
