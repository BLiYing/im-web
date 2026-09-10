// 「就绪文件点击后能不能在浏览器里预览」这份清单的护栏。
//
// **判据不在客户端**：`/uploads/` 只对服务端 `inlineMIME` 白名单内的类型内联下发，
// 白名单外一律 `octet-stream` + `Content-Disposition: attachment`（存储型 XSS 闸）。
// 所以这里多列一个类型，效果不是「能预览了」，而是**那个类型绕过了另存这条路**：
// 点它 → openExternal → 浏览器拿到 attachment → 直接下载。
// 桌面端因此落进 ~/Downloads，而不是弹原生保存框——同样不可预览的文件行为却不一致。
//
// 这两份清单跨仓、同源不了（Go 与 TS），所以两边各有一条把对方钉住的测试
// （另一侧是 IMServer 的 `TestInlineMIMECoversClientPreviewable`），并登记进 docs/SYMMETRY.md。
import { describe, expect, it } from "vitest";
import { isPreviewableFile, PREVIEWABLE_FILE_EXT } from "./messageContent";

/**
 * 与服务端 `inlineMIME` 的交集，**在本文件里写死一份**（不是 import 来的那份）。
 * 两份逐字比对是本护栏的核心：`messageContent.ts` 那边加一个类型 → 下面那条集合相等断言当场红，
 * 于是改的人必须回头确认 IMServer `inlineMIME` 也有它。
 * **改这里必须同时改 IMServer 那侧的 `clientPreviewableExt`。**
 */
const PREVIEWABLE = [
  "pdf",
  "png", "jpg", "jpeg", "gif", "webp", "bmp",
  "mp4", "mov", "webm", "m4v",
  "mp3", "wav", "m4a", "ogg", "aac",
];

/** 服务端**不**内联的：点它们必须走另存（桌面端 = 原生保存框）。 */
const NOT_PREVIEWABLE = [
  // 2026-09-09 从清单里去掉的七个：它们曾被错标成可预览，于是绕过了另存
  "svg", "txt", "md", "log", "json", "csv", "xml",
  // 本来就不可预览的
  "apk", "ipa", "dmg", "pkg", "exe", "msi", "zip", "rar", "7z", "tar", "gz",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "numbers", "pages",
  "sql", "yaml", "yml", "toml", "ini", "py", "go", "java", "sh",
  // 服务端能内联、但浏览器多半渲染不了 → 走另存反而对（刻意不列进可预览）
  "heic", "heif", "tif", "tiff", "ico", "caf", "opus", "flac",
];

describe("就绪文件的预览判据", () => {
  it.each(PREVIEWABLE)("可预览：.%s", (ext) => {
    expect(isPreviewableFile(`合同.${ext}`)).toBe(true);
    expect(isPreviewableFile(`合同.${ext.toUpperCase()}`)).toBe(true);   // 大小写不敏感
  });

  it.each(NOT_PREVIEWABLE)("走另存：.%s", (ext) => {
    expect(isPreviewableFile(`归档.${ext}`)).toBe(false);
  });

  it("只认结尾的扩展名，不能被文件名里的假扩展名骗过去", () => {
    expect(isPreviewableFile("报告.pdf.apk")).toBe(false);   // 真扩展名是 apk
    expect(isPreviewableFile("pdf")).toBe(false);            // 没有点
    expect(isPreviewableFile("")).toBe(false);
    expect(isPreviewableFile("归档.tar.gz")).toBe(false);
  });

  it("清单本身：可预览的这几个，一个不多一个不少", () => {
    // 逐个断言之外再钉一次总量——防止有人只加实现不加用例。
    expect(PREVIEWABLE).toHaveLength(16);
  });

  // 这条是「加一个新类型」那条路的闸：上面的黑名单只能挡它列过的（svg/txt/…），
  // 挡不住 avif/heif/mkv 这种没人想到要写进黑名单的新扩展名。
  // 实现侧的清单与本文件这份必须**集合相等**，多一个少一个都红。
  it("实现侧的清单与本文件这份逐字一致（加新类型时逼你回头看服务端 inlineMIME）", () => {
    expect([...PREVIEWABLE_FILE_EXT].sort()).toEqual([...PREVIEWABLE].sort());
  });
});
