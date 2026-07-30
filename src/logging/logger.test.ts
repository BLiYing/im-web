import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOG_TAG,
  clearDiagnosticLogs,
  diagnosticEntries,
  exportDiagnosticLogs,
  logger,
  setLogLevel,
} from "./logger";

describe("统一日志缓冲", () => {
  beforeEach(() => {
    clearDiagnosticLogs();
    setLogLevel("debug");
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("输出稳定 Tag 并把 Error 转成可导出的结构", () => {
    logger.error(LOG_TAG.app, "failed", { error: new Error("boom") });
    const [entry] = diagnosticEntries();
    expect(entry.tag).toBe("IM.APP");
    expect(entry.event).toBe("failed");
    expect(entry.fields?.error).toMatchObject({ name: "Error", message: "boom" });
    expect(exportDiagnosticLogs()).toContain("\"event\":\"failed\"");
  });

  it("最多保留最近 500 条", () => {
    for (let i = 0; i < 505; i++) logger.debug(LOG_TAG.ui, `event_${i}`);
    const entries = diagnosticEntries();
    expect(entries).toHaveLength(500);
    expect(entries[0].event).toBe("event_5");
    expect(entries[499].event).toBe("event_504");
  });

  it("遵循最小日志级别", () => {
    setLogLevel("warn");
    logger.info(LOG_TAG.http, "hidden");
    logger.warn(LOG_TAG.http, "visible");
    expect(diagnosticEntries().map((entry) => entry.event)).toEqual(["visible"]);
  });
});
