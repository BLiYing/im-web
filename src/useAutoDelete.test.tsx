// @vitest-environment jsdom
// useAutoDelete：入库过滤口径、清理（复用本地移除路径 + 会话行本地重算）、改档位的确认 / 回滚 / 单飞。
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { useAutoDelete, SWEEP_INTERVAL_MS, type UseAutoDeleteOptions } from "./useAutoDelete";
import type { ChatMessage, Conversation } from "./sdk/protocol";
import type { IMClient } from "./sdk/imSdk";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const m = (seq: number, ts: number, from = "u2"): ChatMessage =>
  ({ convId: "c1", from, content: `m${seq}`, contentType: "text", convSeq: seq, timestamp: ts, status: "sent" }) as ChatMessage;
const conv = (over: Partial<Conversation> = {}): Conversation => ({
  conv_id: "c1", peer: "u2", unread: 2, read_seq: 0, latest_conv_seq: 3, peer_read_seq: 0, pinned_at: 5, muted: true, marked_unread: false,
  last_message: { server_msg_id: "s3", from: "u2", content_type: "text", content: "m3", conv_seq: 3, timestamp: NOW - 2 * DAY },
  ...over,
} as Conversation);

function setup(over: Partial<UseAutoDeleteOptions> = {}, convs: Conversation[] = [conv({ auto_delete_sec: 86400 })]) {
  const client = { removeMessagesLocal: vi.fn(async () => {}), updateConvSettings: vi.fn(async () => {}) };
  const clientRef = { current: client as unknown as IMClient } as MutableRefObject<IMClient | null>;
  const state = { convs };
  const setConversations = vi.fn((f: Conversation[] | ((p: Conversation[]) => Conversation[])) => { state.convs = typeof f === "function" ? f(state.convs) : f; });
  const opts: UseAutoDeleteOptions = {
    clientRef, uid: "u1", conversations: convs, setConversations: setConversations as never,
    msgsByConv: { c1: [m(1, NOW - 3 * DAY), m(2, NOW - 2 * DAY), m(3, NOW - 2 * DAY + 1000), m(4, NOW - 1000)] }, connState: "connected",
    refreshConversations: vi.fn(async () => []), askConfirm: vi.fn(async () => true), setToast: vi.fn(), ...over,
  };
  return { client, opts, state, setConversations };
}
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe("useAutoDelete", () => {
  it("isExpired 按会话档位、含等号；未设档位恒 false", () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { opts } = setup();
    const { result } = renderHook(() => useAutoDelete(opts));
    expect(result.current.isExpired("c1", NOW - DAY)).toBe(true);
    expect(result.current.isExpired("c1", NOW - DAY + 1)).toBe(false);
    expect(result.current.isExpired("other", 1)).toBe(false);
  });

  it("挂载即全量扫：过期消息走本地移除路径（不调服务端），会话行预览 / 未读本地重算且保留", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { client, opts, state } = setup();
    renderHook(() => useAutoDelete(opts));
    await flush();
    expect(client.removeMessagesLocal).toHaveBeenCalledWith("c1", [1, 2, 3]);
    expect(state.convs).toHaveLength(1);
    expect(state.convs[0].last_message?.conv_seq).toBe(4); // 预览 = 剩余最后一条
    expect(state.convs[0].unread).toBe(0); // 被清掉的 3 条他人未读扣掉
  });

  it("全部过期 → 预览为空但会话行仍在", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { opts, state } = setup({ msgsByConv: { c1: [m(1, NOW - 3 * DAY), m(3, NOW - 2 * DAY)] } });
    renderHook(() => useAutoDelete(opts));
    await flush();
    expect(state.convs).toHaveLength(1);
    expect(state.convs[0].last_message).toBeNull();
  });

  it("档位关闭的会话不扫", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { client, opts } = setup({}, [conv({ auto_delete_sec: 0 })]);
    renderHook(() => useAutoDelete(opts));
    await flush();
    expect(client.removeMessagesLocal).not.toHaveBeenCalled();
  });

  it("前台每 30 秒再扫：到点的消息被清；页面不可见时不扫", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const msgs = { c1: [m(1, NOW - DAY + 20_000)] }; // 20 秒后满 1 天
    const { client, opts } = setup({ msgsByConv: msgs });
    renderHook(() => useAutoDelete(opts));
    await flush();
    expect(client.removeMessagesLocal).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(SWEEP_INTERVAL_MS); });
    await flush();
    expect(client.removeMessagesLocal).toHaveBeenCalledWith("c1", [1]);
    client.removeMessagesLocal.mockClear();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => { vi.advanceTimersByTime(SWEEP_INTERVAL_MS); });
    await flush();
    expect(client.removeMessagesLocal).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("单飞：清理在途时的重复触发合并，不并发调用本地移除", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { client, opts } = setup();
    let release!: () => void;
    client.removeMessagesLocal.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    renderHook(() => useAutoDelete(opts));
    await flush();
    await act(async () => { vi.advanceTimersByTime(SWEEP_INTERVAL_MS); document.dispatchEvent(new Event("visibilitychange")); });
    expect(client.removeMessagesLocal).toHaveBeenCalledTimes(1); // 第一轮还没返回，后来的只置脏
    await act(async () => { release(); await Promise.resolve(); });
    await flush();
    expect(client.removeMessagesLocal.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  describe("setConvAutoDelete", () => {
    it("开启：先确认；取消 → 不 PUT、不清理", async () => {
      vi.useFakeTimers(); vi.setSystemTime(NOW);
      const c = conv({ auto_delete_sec: 0 });
      const { client, opts } = setup({ askConfirm: vi.fn(async () => false) }, [c]);
      const { result } = renderHook(() => useAutoDelete(opts));
      let ok = true;
      await act(async () => { ok = await result.current.setConvAutoDelete(c, 86400); });
      expect(ok).toBe(false);
      expect(opts.askConfirm).toHaveBeenCalledTimes(1);
      expect(client.updateConvSettings).not.toHaveBeenCalled();
      expect(client.removeMessagesLocal).not.toHaveBeenCalled();
    });
    it("确认后 PUT（其余开关原样回传）并立即本地清理", async () => {
      vi.useFakeTimers(); vi.setSystemTime(NOW);
      const c = conv({ auto_delete_sec: 0 });
      const { client, opts } = setup({}, [c]);
      const { result } = renderHook(() => useAutoDelete(opts));
      let ok = false;
      await act(async () => { ok = await result.current.setConvAutoDelete(c, 86400); });
      expect(ok).toBe(true);
      expect(client.updateConvSettings).toHaveBeenCalledWith("c1", { pinned_at: 5, muted: true, marked_unread: false, auto_delete_sec: 86400 });
      await flush();
      expect(client.removeMessagesLocal).toHaveBeenCalledWith("c1", [1, 2, 3]);
      expect(opts.refreshConversations).toHaveBeenCalled();
    });
    it("缩短要确认；放宽 / 关闭直接保存不弹窗", async () => {
      const c = conv({ auto_delete_sec: 604800 });
      const { opts } = setup({}, [c]);
      const { result } = renderHook(() => useAutoDelete(opts));
      await act(async () => { await result.current.setConvAutoDelete(c, 86400); });
      expect(opts.askConfirm).toHaveBeenCalledTimes(1);
      await act(async () => { await result.current.setConvAutoDelete(c, 2592000); });
      await act(async () => { await result.current.setConvAutoDelete(c, 0); });
      expect(opts.askConfirm).toHaveBeenCalledTimes(1);
    });
    it("PUT 失败 → toast autodel.save_failed、返回 false、本地不变不清理", async () => {
      vi.useFakeTimers(); vi.setSystemTime(NOW);
      const c = conv({ auto_delete_sec: 0 });
      const { client, opts, state } = setup({}, [c]);
      client.updateConvSettings.mockRejectedValueOnce(new Error("boom"));
      const { result } = renderHook(() => useAutoDelete(opts));
      let ok = true;
      await act(async () => { ok = await result.current.setConvAutoDelete(c, 86400); });
      expect(ok).toBe(false);
      expect(opts.setToast).toHaveBeenCalledWith("设置失败，请稍后重试");
      expect(state.convs[0].auto_delete_sec ?? 0).toBe(0);
      expect(client.removeMessagesLocal).not.toHaveBeenCalled();
    });
  });

  it("conv_update：就地覆盖档位并立即清理（别的设备开启的场景）", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { client, opts, state } = setup({}, [conv({ auto_delete_sec: 0 })]);
    const { result } = renderHook(() => useAutoDelete(opts));
    await flush();
    expect(client.removeMessagesLocal).not.toHaveBeenCalled();
    await act(async () => { result.current.applyConvUpdate({ conv_id: "c1", action: "settings", pinned_at: 0, muted: false, mute_until: 0, marked_unread: false, auto_delete_sec: 86400 }); });
    await flush();
    expect(state.convs[0].auto_delete_sec).toBe(86400);
    expect(client.removeMessagesLocal).toHaveBeenCalledWith("c1", [1, 2, 3]);
  });
});
