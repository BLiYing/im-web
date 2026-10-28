// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExportDataPanel } from "./ExportDataPanel";
import type { DataExportState } from "../../useDataExport";
import type { ExportJob } from "../../sdk/exportApi";

afterEach(cleanup);
const job = (o: Partial<ExportJob> = {}): ExportJob => ({
  id: "e1", status: "running", includeMedia: false, formats: [], doneConvs: 3, totalConvs: 12,
  result: null, createdAt: 1, finishedAt: 0, expiresAt: 0, errorCode: "", ...o,
});
const state = (o: Partial<DataExportState> = {}): DataExportState => ({
  loaded: true, loadError: "", view: { kind: "config" }, job: null, password: "", setPassword: vi.fn(),
  includeMedia: false, setIncludeMedia: vi.fn(), html: true, setHtml: vi.fn(), json: true, setJson: vi.fn(),
  busy: false, downloading: false, error: "", canStart: false, start: vi.fn(), cancel: vi.fn(), download: vi.fn(),
  retry: vi.fn(), reload: vi.fn(), ...o,
});
const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("ExportDataPanel 四态", () => {
  it("配置态：开始按钮随 canStart；密码错内联红字", () => {
    render(<ExportDataPanel s={state({ error: "密码错误" })} onBack={vi.fn()} />);
    expect(btn("开始导出").disabled).toBe(true);
    expect(screen.getByText("密码错误")).toBeTruthy();
    cleanup();
    render(<ExportDataPanel s={state({ canStart: true })} onBack={vi.fn()} />);
    expect(btn("开始导出").disabled).toBe(false);
  });
  it("进行中：进度文案 + 取消", () => {
    render(<ExportDataPanel s={state({ view: { kind: "running" }, job: job() })} onBack={vi.fn()} />);
    expect(screen.getByText("已处理 3 / 12 个会话")).toBeTruthy();
    expect(btn("取消导出")).toBeTruthy();
  });
  it("进度条：总数已知给 valuemax/now；总数为 0 不设无效区间，改 aria-busy", () => {
    const { rerender } = render(<ExportDataPanel s={state({ view: { kind: "running" }, job: job() })} onBack={vi.fn()} />);
    let bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuemax")).toBe("12");
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(bar.hasAttribute("aria-busy")).toBe(false);
    rerender(<ExportDataPanel s={state({ view: { kind: "running" }, job: job({ totalConvs: 0, doneConvs: 0 }) })} onBack={vi.fn()} />);
    bar = screen.getByRole("progressbar");
    expect(bar.hasAttribute("aria-valuemax")).toBe(false);
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
    expect(bar.getAttribute("aria-busy")).toBe("true");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("0%");
  });
  it("完成：摘要 + 下载", () => {
    const j = job({ status: "done", result: { sizeBytes: 5 * 1024 * 1024, convCount: 12, msgCount: 8431 }, expiresAt: 1e12 + 5 });
    render(<ExportDataPanel s={state({ view: { kind: "done" }, job: j })} onBack={vi.fn()} />);
    expect(screen.getByText("5 MB · 12 个会话 · 8431 条消息")).toBeTruthy();
    expect(btn("下载")).toBeTruthy();
  });
  it("冷却：说明 + 按钮置灰；失败：红字 + 重试", () => {
    render(<ExportDataPanel s={state({ view: { kind: "cooldown", hours: 3 } })} onBack={vi.fn()} />);
    expect(screen.getByText("24 小时内只能导出一次，3 小时后可再次导出。")).toBeTruthy();
    expect(btn("开始导出").disabled).toBe(true);
    cleanup();
    render(<ExportDataPanel s={state({ view: { kind: "failed" }, job: job({ status: "failed" }) })} onBack={vi.fn()} />);
    expect(btn("重试")).toBeTruthy();
  });
});
