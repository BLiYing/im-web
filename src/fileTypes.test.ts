import { describe, expect, it } from "vitest";
import { fileTypeForName, mediaKindForFile, webCanRenderMedia } from "./fileTypes";

describe("fileTypeForName", () => {
  it("maps mainstream Windows, macOS and media formats", () => {
    const cases: Record<string, string> = {
      "report.pdf": "pdf", "letter.docx": "word", "budget.xlsx": "excel", "deck.pptx": "powerpoint",
      "export.csv": "csv", "draft.pages": "pages", "forecast.numbers": "numbers", "talk.key": "keynote",
      "notes.txt": "text", "readme.md": "markdown", "layout.xml": "xml", "data.json": "json",
      "photo.heic": "image", "clip.mov": "video", "voice.flac": "audio", "bundle.7z": "archive",
      "screen.swift": "code", "cache.sqlite": "database", "face.woff2": "font", "book.epub": "ebook",
      "installer.dmg": "package",
    };
    for (const [name, kind] of Object.entries(cases)) expect(fileTypeForName(name)).toBe(kind);
  });

  it("handles uploaded URLs, case and unknown extensions", () => {
    expect(fileTypeForName("https://host/uploads/id__Quarterly%20Report.XLSX?token=1")).toBe("excel");
    expect(fileTypeForName("mystery.custom-format")).toBe("unknown");
    expect(fileTypeForName(undefined)).toBe("unknown");
  });
});

describe("mediaKindForFile", () => {
  it("classifies by MIME prefix first", () => {
    expect(mediaKindForFile({ name: "a.jpg", type: "image/jpeg" })).toBe("image");
    expect(mediaKindForFile({ name: "a.mp4", type: "video/mp4" })).toBe("video");
  });

  it("falls back to extension when MIME is missing (drag/paste)", () => {
    expect(mediaKindForFile({ name: "photo.HEIC", type: "" })).toBe("image");
    expect(mediaKindForFile({ name: "clip.mov", type: "" })).toBe("video");
  });

  it("treats # and ? in local filenames as literal, not URL delimiters", () => {
    // 本地文件名里的 # / ? 是普通字符；按 URL 规则截断会丢掉扩展名而误拒合法媒体。
    expect(mediaKindForFile({ name: "IMG #12.HEIC", type: "" })).toBe("image");
    expect(mediaKindForFile({ name: "clip (1)?.mp4", type: "" })).toBe("video");
  });

  it("rejects non-media and svg (server refuses svg → block early)", () => {
    expect(mediaKindForFile({ name: "report.pdf", type: "application/pdf" })).toBeNull();
    expect(mediaKindForFile({ name: "logo.svg", type: "image/svg+xml" })).toBeNull();
    expect(mediaKindForFile({ name: "logo.svg", type: "" })).toBeNull();
    expect(mediaKindForFile({ name: "mystery", type: "" })).toBeNull();
  });
});

describe("webCanRenderMedia", () => {
  it("allows formats browsers render natively", () => {
    expect(webCanRenderMedia("image", "a.jpg")).toBe(true);
    expect(webCanRenderMedia("image", "a.png")).toBe(true);
    expect(webCanRenderMedia("image", "a.webp")).toBe(true);
    expect(webCanRenderMedia("video", "a.mp4")).toBe(true);
    expect(webCanRenderMedia("video", "a.webm")).toBe(true);
    expect(webCanRenderMedia("video", "a.mov")).toBe(true); // 多为 H.264，乐观放行（坏编码由 onError 兜底）
  });

  it("blocks known-unrenderable containers (case-insensitive, works on URLs)", () => {
    expect(webCanRenderMedia("image", "/uploads/req__photo.HEIC")).toBe(false);
    expect(webCanRenderMedia("image", "scan.tiff")).toBe(false);
    expect(webCanRenderMedia("image", "raw.dng")).toBe(false);
    expect(webCanRenderMedia("video", "clip.mkv")).toBe(false);
    expect(webCanRenderMedia("video", "clip.avi")).toBe(false);
    expect(webCanRenderMedia("video", "clip.wmv")).toBe(false);
  });

  it("defaults to renderable for unknown/extensionless (blob:/data:) — let onError decide", () => {
    expect(webCanRenderMedia("image", "blob:http://localhost:5173/abcd-uuid")).toBe(true);
    expect(webCanRenderMedia("image", "data:image/png;base64,AAAA")).toBe(true);
    expect(webCanRenderMedia("video", "mystery")).toBe(true);
  });
});
