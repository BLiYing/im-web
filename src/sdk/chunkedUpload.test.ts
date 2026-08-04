// 分片上传核心语义回归：happy path / 业务拒绝换会话重传 / 取消 / 暂停不再发请求。
// mock 全局 fetch（tracedFetch 底层），按 URL 分发响应，记录调用序列供断言。
import { describe, it, expect, beforeEach, vi } from "vitest";
import { startChunkedUpload, chunkedTaskFor, UploadCancelledError, CHUNK_SIZE } from "./chunkedUpload";

const FILE_SIZE = CHUNK_SIZE * 2 + 1024; // 3 片：8M + 8M + 1KB

function makeFile(): File {
  return new File([new Uint8Array(FILE_SIZE)], "big.mp4", { type: "video/mp4" });
}

type MockBody = { code: number; message?: string; data?: Record<string, unknown> };
type MockReturn = MockBody | string; // string = 非 JSON 网关响应（502 HTML）

/** 按路径分发的 fetch mock（支持异步 handler 模拟慢请求）；尊重 AbortSignal；返回调用记录。 */
function mockFetch(handler: (url: string, init: RequestInit) => MockReturn | Promise<MockReturn>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push(`${init.method ?? "GET"} ${url}`);
    if (init.signal?.aborted) { throw new DOMException("Aborted", "AbortError"); }
    const aborted = new Promise<never>((_, rej) => {
      init.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")));
    });
    const body = await Promise.race([Promise.resolve(handler(url, init)), aborted]);
    // handler 返回字符串 = 模拟非 JSON 网关响应（502 HTML）：原样作为响应体、5xx 状态。
    if (typeof body === "string") return new Response(body, { status: 502 });
    return new Response(JSON.stringify(body), { status: body.code === 0 ? 200 : 400 });
  }));
  return calls;
}

/** 标准服务端行为：init 发会话、chunk 顺序追加返回权威 offset、complete 出 URL。 */
function standardHandler(state: { offset: number; inits: number }) {
  return (url: string, init: RequestInit) => {
    if (url.includes("/upload/init")) {
      state.inits += 1;
      state.offset = 0;
      return { code: 0, data: { upload_id: `u${state.inits}`, offset: 0, chunk_size: CHUNK_SIZE } };
    }
    if (url.includes("/status")) return { code: 0, data: { upload_id: "u", size: FILE_SIZE, offset: state.offset } };
    if (url.includes("/chunk")) {
      const declared = Number(new URL(url, "http://x").searchParams.get("offset"));
      if (declared === state.offset) { state.offset += (init.body as Blob).size; }
      return { code: 0, data: { offset: state.offset } };
    }
    if (url.includes("/complete")) return { code: 0, data: { url: "/uploads/req-x__big.mp4", content_type: "video", size: FILE_SIZE } };
    throw new Error(`unexpected ${url}`);
  };
}

beforeEach(() => { vi.unstubAllGlobals(); });

describe("chunkedUpload", () => {
  it("happy path：init → 3 片 → complete，进度按分片推进", async () => {
    const state = { offset: 0, inits: 0 };
    const calls = mockFetch(standardHandler(state));
    const progress: number[] = [];
    const res = await startChunkedUpload(makeFile(), "tok", "k1", (sent) => progress.push(sent));
    expect(res.url).toBe("/uploads/req-x__big.mp4");
    expect(res.contentType).toBe("video");
    expect(calls.filter((c) => c.includes("/chunk")).length).toBe(3);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(FILE_SIZE);
    expect(chunkedTaskFor("k1")).toBeUndefined(); // 终态后注销
  });

  it("服务端会话丢失（业务 400）：自动换新会话从头传，最终成功", async () => {
    const state = { offset: 0, inits: 0 };
    let failedOnce = false;
    const calls = mockFetch((url, init) => {
      // 第一片成功后，第二片模拟「上传会话不存在或已过期」
      if (url.includes("/chunk") && state.offset >= CHUNK_SIZE && !failedOnce) {
        failedOnce = true;
        return { code: 100001, message: "上传会话不存在或已过期" };
      }
      return standardHandler(state)(url, init);
    });
    const res = await startChunkedUpload(makeFile(), "tok", "k2");
    expect(res.url).toBe("/uploads/req-x__big.mp4");
    expect(calls.filter((c) => c.includes("/upload/init")).length).toBe(2); // 换过一次会话
  });

  it("确定性业务拒绝（如 FileTooLarge 500001）：立即失败，不换会话重传", async () => {
    const state = { offset: 0, inits: 0 };
    const calls = mockFetch((url, init) => {
      if (url.includes("/chunk")) return { code: 500001, message: "文件过大" };
      return standardHandler(state)(url, init);
    });
    await expect(startChunkedUpload(makeFile(), "tok", "k5")).rejects.toThrow();
    expect(calls.filter((c) => c.includes("/upload/init")).length).toBe(1); // 只 init 一次，绝不 3 遍从头重传
  });

  it("非 JSON 网关错误（502 HTML）：当作瞬时网络失败退避续传，不清 upload_id 从 0 重传", async () => {
    vi.useFakeTimers();
    try {
      const state = { offset: 0, inits: 0 };
      let hiccuped = false;
      const calls = mockFetch((url, init) => {
        // 第二片一次性返回非 JSON 502（网关抖动）；服务端 offset 完好。
        if (url.includes("/chunk") && state.offset >= CHUNK_SIZE && !hiccuped) {
          hiccuped = true;
          return "<html>502 Bad Gateway</html>";
        }
        return standardHandler(state)(url, init);
      });
      const p = startChunkedUpload(makeFile(), "tok", "k6");
      await vi.advanceTimersByTimeAsync(2500); // 跨过 2s 退避
      const res = await p;
      expect(res.url).toBe("/uploads/req-x__big.mp4");
      expect(calls.filter((c) => c.includes("/upload/init")).length).toBe(1); // 未换会话
      expect(calls.some((c) => c.includes("/status"))).toBe(true); // 退避后经 status 拿权威 offset 续传
    } finally {
      vi.useRealTimers();
    }
  });

  it("取消：promise 以 UploadCancelledError 拒绝并注销任务", async () => {
    const state = { offset: 0, inits: 0 };
    mockFetch(standardHandler(state));
    const p = startChunkedUpload(makeFile(), "tok", "k3");
    chunkedTaskFor("k3")!.cancel();
    await expect(p).rejects.toBeInstanceOf(UploadCancelledError);
    expect(chunkedTaskFor("k3")).toBeUndefined();
  });

  it("暂停真中断在飞请求且不再发新请求；恢复先问 status 再从服务端 offset 续传", async () => {
    const state = { offset: 0, inits: 0 };
    let chunk2Started: (() => void) | null = null;
    const chunk2InFlight = new Promise<void>((r) => { chunk2Started = r; });
    let hangChunk2 = true;
    const base = standardHandler(state);
    const calls = mockFetch(async (url, init) => {
      // 第二片首次到达时挂起不返回：给测试一个确定的"传输中"窗口去点暂停。
      if (url.includes("/chunk") && url.includes(`offset=${CHUNK_SIZE}`) && hangChunk2) {
        hangChunk2 = false;
        chunk2Started!();
        await new Promise(() => { /* 永不 resolve；被 pause 的 abort 掐断 */ });
      }
      return base(url, init);
    });
    const p = startChunkedUpload(makeFile(), "tok", "k4");
    const task = chunkedTaskFor("k4")!;
    await chunk2InFlight; // 第二片正在传
    task.pause();
    const countAtPause = calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.length).toBe(countAtPause); // 暂停期间零新请求
    task.resume();
    const res = await p;
    expect(res.url).toBe("/uploads/req-x__big.mp4");
    expect(calls.some((c) => c.includes("/status"))).toBe(true); // 恢复以服务端 offset 为准
  });
});
