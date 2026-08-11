import { describe, expect, it } from "vitest";
import { fileTypeForName, mediaKindForFile } from "./fileTypes";

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

  it("rejects non-media and svg (server refuses svg → block early)", () => {
    expect(mediaKindForFile({ name: "report.pdf", type: "application/pdf" })).toBeNull();
    expect(mediaKindForFile({ name: "logo.svg", type: "image/svg+xml" })).toBeNull();
    expect(mediaKindForFile({ name: "logo.svg", type: "" })).toBeNull();
    expect(mediaKindForFile({ name: "mystery", type: "" })).toBeNull();
  });
});
