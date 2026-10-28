import { describe, expect, it } from "vitest";
import { parseExportJob, resolveDownloadUrl } from "./exportApi";

describe("parseExportJob", () => {
  it("完整对象", () => {
    const j = parseExportJob({
      id: "e1", status: "done", include_media: true, formats: ["html", "json"],
      progress: { done_convs: 12, total_convs: 12 },
      result: { size_bytes: 1000, conv_count: 12, msg_count: 8431 },
      created_at: 1700000000000, finished_at: 1700000100000, expires_at: 1700086400000, error_code: null,
    });
    expect(j).toMatchObject({ id: "e1", status: "done", includeMedia: true, formats: ["html", "json"], doneConvs: 12, totalConvs: 12 });
    expect(j?.result).toEqual({ sizeBytes: 1000, convCount: 12, msgCount: 8431 });
    expect(j?.finishedAt).toBe(1700000100000);
  });
  it("error_code 是字符串枚举（服务端 interrupted / internal），null → 空串", () => {
    expect(parseExportJob({ id: "1", status: "failed", error_code: "interrupted" })?.errorCode).toBe("interrupted");
    expect(parseExportJob({ id: "1", status: "failed", error_code: "internal" })?.errorCode).toBe("internal");
    expect(parseExportJob({ id: "1", status: "failed", error_code: null })?.errorCode).toBe("");
  });
  it("null / 非对象 / 缺 id → null", () => {
    expect(parseExportJob(null)).toBeNull();
    expect(parseExportJob("x")).toBeNull();
    expect(parseExportJob({ status: "done" })).toBeNull();
  });
  it("未知状态按 failed 兜底（不会卡在进行中）", () => {
    expect(parseExportJob({ id: "1", status: "weird" })?.status).toBe("failed");
  });
  it("缺字段给安全默认；秒级时间戳归一为毫秒；result 缺失为 null", () => {
    const j = parseExportJob({ id: "1", status: "running", finished_at: 1700000100 });
    expect(j).toMatchObject({ includeMedia: false, formats: [], doneConvs: 0, totalConvs: 0, result: null, finishedAt: 1700000100000, expiresAt: 0 });
  });
});

describe("resolveDownloadUrl", () => {
  it("相对路径拼基址", () => {
    expect(resolveDownloadUrl("/api/v1/exports/download?t=a", "https://h")).toBe("https://h/api/v1/exports/download?t=a");
    expect(resolveDownloadUrl("/api/x", "")).toBe("/api/x");
  });
  it("基址尾斜杠不重复；绝对地址原样", () => {
    expect(resolveDownloadUrl("/a", "https://h/")).toBe("https://h/a");
    expect(resolveDownloadUrl("https://cdn/a", "https://h")).toBe("https://cdn/a");
  });
});
