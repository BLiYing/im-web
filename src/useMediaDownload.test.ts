// @vitest-environment jsdom
// useMediaDownload（阶段 4 抽出）的判定/状态机回归：门控优先级（失效 > 解门控 > 策略）、解门控幂等落盘、
// 退登清空、mediaSrc 回退。只断言与策略默认值无关的确定性路径（策略细节由 download.test 覆盖）。
import { describe, it, expect, vi, beforeEach , afterEach } from "vitest";
import { renderHook, act , cleanup } from "@testing-library/react";
import { createRef } from "react";
import { useMediaDownload } from "./useMediaDownload";
import type { ChatMessage } from "./sdk/protocol";
import type { IMClient } from "./sdk/imSdk";
import { loadStrSet, expiredKey, saveStrSet, downloadedFilesKey } from "./mediaCache";
import * as mediaCache from "./mediaCache";
afterEach(cleanup); // 多次 renderHook：卸载前一用例（CODING_STYLE §八）

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  convId: "c1", from: "u2", content: "https://cdn/x/a.png", contentType: "image", convSeq: 1, timestamp: 1, status: "sent", fileSize: 1024, ...over,
} as ChatMessage);
function mount(uid = "u1") {
  const setToast = vi.fn(), setViewer = vi.fn();
  const clientRef = createRef<IMClient | null>() as React.MutableRefObject<IMClient | null>; clientRef.current = null;
  const hook = renderHook(() => useMediaDownload({ uid, groupConvId: "", clientRef, setToast, setViewer }));
  return { ...hook, setToast, setViewer };
}
beforeEach(() => { localStorage.clear(); });

describe("useMediaDownload", () => {
  it("自己发的 / 撤回的 / 非媒体 → 不门控（undefined）", () => {
    const { result } = mount();
    expect(result.current.mediaGate(msg({ from: "u1" }))).toBeUndefined();
    expect(result.current.mediaGate(msg({ recalledAt: 1 }))).toBeUndefined();
    expect(result.current.mediaGate(msg({ contentType: "text", content: "hi" }))).toBeUndefined();
  });
  it("markExpired → 失效态优先于策略，且按 uid 持久化到 localStorage", () => {
    const { result } = mount("u1");
    act(() => result.current.markExpired("https://cdn/x/a.png"));
    expect(result.current.mediaGate(msg())?.phase).toBe("expired");
    expect(result.current.expiredSet.has("https://cdn/x/a.png")).toBe(true);
    expect(loadStrSet(expiredKey("u1")).has("https://cdn/x/a.png")).toBe(true); // 按 uid 落 localStorage
  });
  it("optInMedia / onGateTap(图片) → 解门控（就绪），幂等", () => {
    const { result } = mount();
    act(() => result.current.optInMedia("https://cdn/x/a.png"));
    expect(result.current.mediaGate(msg())).toBeUndefined();
    const before = result.current.mediaOptedIn;
    act(() => result.current.optInMedia("https://cdn/x/a.png"));
    expect(result.current.mediaOptedIn).toBe(before); // 幂等：同一 Set 引用
    act(() => result.current.onGateTap(msg({ content: "https://cdn/x/b.png" })));
    expect(result.current.mediaGate(msg({ content: "https://cdn/x/b.png" }))).toBeUndefined();
  });
  it("resetDownloadState → 解门控 / 失效标记 / 下载态全清", () => {
    const { result } = mount();
    act(() => { result.current.optInMedia("https://cdn/x/a.png"); result.current.markExpired("https://cdn/x/z.png"); });
    act(() => result.current.resetDownloadState());
    expect(result.current.mediaOptedIn.size).toBe(0);
    expect(result.current.expiredSet.size).toBe(0);
    expect(Object.keys(result.current.dlBlobs)).toHaveLength(0);
  });
  it("mediaSrc：无应用内 blob 时回退远端 URL", () => {
    const { result } = mount();
    expect(result.current.mediaSrc(msg())).toBe("https://cdn/x/a.png");
  });
  it("文件：onGateTap 发起下载 → dlStates=downloading；下载中再点 = 取消（真中止 + 回到未下载）", async () => {
    let abortSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_u: string, init?: RequestInit) => { abortSignal = init?.signal ?? undefined; return new Promise(() => {}); }));
    const { result } = mount();
    const f = msg({ contentType: "file", content: "https://cdn/x/f.bin", fileName: "f.bin", fileSize: 5 * 1024 * 1024 * 1024 });
    act(() => result.current.onGateTap(f));
    expect(result.current.dlStates["https://cdn/x/f.bin"]?.phase).toBe("downloading");
    expect(result.current.mediaGate(f)?.phase).toBe("downloading");
    act(() => result.current.onGateTap(f)); // 下载中 → 取消
    expect(abortSignal?.aborted).toBe(true);
    expect(result.current.dlStates["https://cdn/x/f.bin"]).toBeUndefined();
    vi.unstubAllGlobals();
  });
  it("回灌竞态：A 的 restore 尚在飞时 reset（退登）→ 结果作废、不并进后续账号的 dlBlobs", async () => {
    saveStrSet(downloadedFilesKey("uA"), new Set(["https://cdn/a.bin"]));
    let release!: (b: Blob | null) => void;
    vi.spyOn(mediaCache, "cacheMatchBlob").mockImplementation(() => new Promise((r) => { release = r; }));
    URL.createObjectURL = vi.fn(() => "blob:A") as unknown as typeof URL.createObjectURL; URL.revokeObjectURL = vi.fn();
    const { result } = mount("uA");
    let p!: Promise<void>;
    act(() => { p = result.current.restoreDownloadState("uA"); });
    act(() => result.current.resetDownloadState()); // 退登（或切账号）发生在 Cache Storage 循环中途
    await act(async () => { release(new Blob(["x"])); await p; });
    expect(Object.keys(result.current.dlBlobs)).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:A"); // 作废结果的 objectURL 被回收
    vi.restoreAllMocks();
  });
});
