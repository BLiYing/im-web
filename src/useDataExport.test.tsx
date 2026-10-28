// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useDataExport } from "./useDataExport";
import * as api from "./sdk/exportApi";
import type { ExportJob } from "./sdk/exportApi";

vi.mock("./sdk/exportApi", async (orig) => ({ ...(await orig<typeof api>()), getLatestExport: vi.fn(), startExport: vi.fn(), cancelExport: vi.fn(), getExportDownloadUrl: vi.fn() }));
const m = vi.mocked(api);

const job = (o: Partial<ExportJob> = {}): ExportJob => ({
  id: "e1", status: "running", includeMedia: false, formats: ["html", "json"], doneConvs: 1, totalConvs: 4,
  result: null, createdAt: 1, finishedAt: 0, expiresAt: 0, errorCode: "", ...o,
});
const err = (code: number, extra: object = {}) => Object.assign(new Error("x"), { code }, extra);

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); });

function setup() {
  const setToast = vi.fn(); const navigate = vi.fn();
  const hook = renderHook(() => useDataExport({ token: () => "tk", setToast, navigate, base: "https://h", pollMs: 20 }));
  return { hook, setToast, navigate };
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("useDataExport", () => {
  it("进入取 latest；null → 配置态", async () => {
    m.getLatestExport.mockResolvedValue(null);
    const { hook } = setup(); await flush();
    expect(hook.result.current.loaded).toBe(true);
    expect(hook.result.current.view.kind).toBe("config");
  });

  it("进行中每 按间隔轮询，完成后停止", async () => {
    m.getLatestExport.mockResolvedValueOnce(job()).mockResolvedValueOnce(job({ doneConvs: 2 })).mockResolvedValue(job({ status: "done", finishedAt: Date.now(), expiresAt: Date.now() + 1e6 }));
    const { hook } = setup(); await flush();
    expect(hook.result.current.view.kind).toBe("running");
    await wait(30);
    expect(hook.result.current.job?.doneConvs).toBe(2);
    await wait(30);
    expect(hook.result.current.view.kind).toBe("done");
    const calls = m.getLatestExport.mock.calls.length;
    await wait(120);
    expect(m.getLatestExport.mock.calls.length).toBe(calls);
  });

  it("进度没变也持续轮询；卸载即停", async () => {
    m.getLatestExport.mockResolvedValue(job());
    const { hook } = setup(); await flush();
    await vi.waitFor(() => expect(m.getLatestExport.mock.calls.length).toBeGreaterThanOrEqual(4)); // act 外让效果自行重排
    hook.unmount();
    const n = m.getLatestExport.mock.calls.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(m.getLatestExport.mock.calls.length).toBe(n);
  });

  it("开始导出成功 → 进入进行中并清空密码", async () => {
    m.getLatestExport.mockResolvedValue(null); m.startExport.mockResolvedValue(job());
    const { hook } = setup(); await flush();
    act(() => hook.result.current.setPassword("pw"));
    await act(async () => { await hook.result.current.start(); });
    expect(m.startExport).toHaveBeenCalledWith("tk", { password: "pw", includeMedia: false, formats: ["html", "json"] });
    expect(hook.result.current.view.kind).toBe("running");
    expect(hook.result.current.password).toBe("");
  });

  it("密码错 200002：内联错误，输入保留，仍在配置态", async () => {
    m.getLatestExport.mockResolvedValue(null); m.startExport.mockRejectedValue(err(200002));
    const { hook } = setup(); await flush();
    act(() => hook.result.current.setPassword("bad"));
    await act(async () => { await hook.result.current.start(); });
    expect(hook.result.current.error).toBe("密码错误");
    expect(hook.result.current.password).toBe("bad");
    expect(hook.result.current.view.kind).toBe("config");
  });

  it("冷却 200011：带 retry_after_sec → 冷却态向上取整小时、按钮置灰", async () => {
    m.getLatestExport.mockResolvedValue(null); m.startExport.mockRejectedValue(err(200011, { retryAfterSec: 3601 }));
    const { hook } = setup(); await flush();
    act(() => hook.result.current.setPassword("pw"));
    await act(async () => { await hook.result.current.start(); });
    expect(hook.result.current.view).toEqual({ kind: "cooldown", hours: 2 });
    expect(hook.result.current.canStart).toBe(false);
  });

  it("ExportBusy 200010：提示并重取 latest 恢复进度", async () => {
    m.getLatestExport.mockResolvedValueOnce(null).mockResolvedValue(job()); m.startExport.mockRejectedValue(err(200010));
    const { hook } = setup(); await flush();
    act(() => hook.result.current.setPassword("pw"));
    await act(async () => { await hook.result.current.start(); });
    expect(hook.result.current.view.kind).toBe("running");
  });

  it("下载：先取 url 再 navigate(基址+url)；失败 toast export.download_failed", async () => {
    m.getLatestExport.mockResolvedValue(job({ status: "done", finishedAt: Date.now(), expiresAt: Date.now() + 1e6 }));
    m.getExportDownloadUrl.mockResolvedValueOnce("/api/v1/exports/download?t=a").mockRejectedValueOnce(err(1));
    const { hook, navigate, setToast } = setup(); await flush();
    await act(async () => { await hook.result.current.download(); });
    expect(navigate).toHaveBeenCalledWith("https://h/api/v1/exports/download?t=a");
    await act(async () => { await hook.result.current.download(); });
    expect(setToast).toHaveBeenCalledWith("下载失败，请重试");
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("取消后以服务端为准回配置态", async () => {
    m.getLatestExport.mockResolvedValueOnce(job()).mockResolvedValue(job({ status: "canceled" })); m.cancelExport.mockResolvedValue();
    const { hook } = setup(); await flush();
    await act(async () => { await hook.result.current.cancel(); });
    expect(m.cancelExport).toHaveBeenCalledWith("tk", "e1");
    expect(hook.result.current.view.kind).toBe("config");
  });

  it("失败态点重试回配置态；latest 取失败给出可重试错误", async () => {
    m.getLatestExport.mockResolvedValue(job({ status: "failed" }));
    const { hook } = setup(); await flush();
    expect(hook.result.current.view.kind).toBe("failed");
    act(() => hook.result.current.retry());
    expect(hook.result.current.view.kind).toBe("config");
    m.getLatestExport.mockRejectedValue(new Error("offline"));
    await act(async () => { await hook.result.current.reload(); });
    expect(hook.result.current.loadError).toBe("offline");
  });

  it("完成态到 expires_at 自动重渲染：不再给下载，并重取 latest", async () => {
    const t0 = Date.now();
    m.getLatestExport.mockResolvedValueOnce(job({ status: "done", finishedAt: t0, expiresAt: t0 + 60 }))
      .mockResolvedValue(job({ status: "expired", finishedAt: t0 - 2 * 86400_000, expiresAt: t0 + 60 }));
    const { hook } = setup(); await flush();
    expect(hook.result.current.view.kind).toBe("done");
    await wait(150);
    expect(hook.result.current.view.kind).not.toBe("done");
    expect(m.getLatestExport.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("过期定时器卸载即清", async () => {
    const t0 = Date.now();
    m.getLatestExport.mockResolvedValue(job({ status: "done", finishedAt: t0, expiresAt: t0 + 80 }));
    const { hook } = setup(); await flush();
    hook.unmount();
    const n = m.getLatestExport.mock.calls.length;
    await new Promise((r) => setTimeout(r, 160));
    expect(m.getLatestExport.mock.calls.length).toBe(n);
  });

  it("乱序：旧的 latest 响应晚于 start 返回时被丢弃，不覆盖新任务", async () => {
    let release: (v: ExportJob | null) => void = () => {};
    m.getLatestExport.mockReturnValueOnce(new Promise((r) => { release = r; }));
    m.startExport.mockResolvedValue(job());
    const { hook } = setup();
    act(() => hook.result.current.setPassword("pw"));
    await act(async () => { await hook.result.current.start(); });
    expect(hook.result.current.view.kind).toBe("running");
    m.getLatestExport.mockResolvedValue(job());
    await act(async () => { release(null); await new Promise((r) => setTimeout(r, 0)); });
    expect(hook.result.current.view.kind).toBe("running");
  });

  it("默认下载走带 download 属性的隐藏 <a>，不整页跳转", async () => {
    const clicks: HTMLAnchorElement[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    m.getLatestExport.mockResolvedValue(job({ status: "done", finishedAt: Date.now(), expiresAt: Date.now() + 1e6 }));
    m.getExportDownloadUrl.mockResolvedValue("/api/v1/exports/download?t=a");
    const hook = renderHook(() => useDataExport({ token: () => "tk", setToast: vi.fn(), pollMs: 20 }));
    await flush();
    await act(async () => { await hook.result.current.download(); });
    expect(clicks).toHaveLength(1);
    expect(clicks[0].getAttribute("href")).toBe("/api/v1/exports/download?t=a");
    expect(clicks[0].hasAttribute("download")).toBe(true);
    expect(document.querySelector("a[download]")).toBeNull(); // 用完即移除
    spy.mockRestore();
  });
});
