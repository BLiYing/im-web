// @vitest-environment jsdom
// useAutoDelete（v2 会话级 {sec,from}）：入库过滤口径、清理（复用本地移除路径 + 会话行本地重算）、不追溯、改档位的确认 / 回滚 / 300204 / 单飞。
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
  ...(over.auto_delete_sec && over.auto_delete_from === undefined ? { auto_delete_from: 1 } : {}), // 生产态 sec>0 必带 from>0；from<=0 当关闭（sanitizeState）
  ...over,
} as Conversation);

function setup(over: Partial<UseAutoDeleteOptions> = {}, convs: Conversation[] = [conv({ auto_delete_sec: 86400 })]) {
  const client = { removeMessagesLocal: vi.fn(async () => {}), updateConvSettings: vi.fn(async (..._a: unknown[]): Promise<{ auto_delete_sec: number; auto_delete_from: number } | undefined> => undefined), cacheConversations: vi.fn() };
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

  it("isExpired：from 之前永不过期（不追溯）", () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { opts } = setup({}, [conv({ auto_delete_sec: 86400, auto_delete_from: NOW - 2 * DAY })]);
    const { result } = renderHook(() => useAutoDelete(opts));
    expect(result.current.isExpired("c1", NOW - 2 * DAY - 1)).toBe(false); // from 之前，早已满 1 天也留
    expect(result.current.isExpired("c1", NOW - 2 * DAY)).toBe(true); // 恰等 from
  });

  it("挂载扫描只清 [from, now-sec] 内的；from 之前的老消息保留，预览越过窗口取 from 之前的", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const from = NOW - 2 * DAY - 500; // msg1(-3d) 在 from 之前；msg2/3 在窗口内；msg4 未满期
    const { client, opts, state } = setup({ msgsByConv: { c1: [m(1, NOW - 3 * DAY), m(2, NOW - 2 * DAY), m(3, NOW - 2 * DAY + 1000)] } }, [conv({ auto_delete_sec: 86400, auto_delete_from: from })]);
    renderHook(() => useAutoDelete(opts));
    await flush();
    expect(client.removeMessagesLocal).toHaveBeenCalledWith("c1", [2, 3]);
    expect(state.convs[0].last_message?.conv_seq).toBe(1); // 越过过期窗口取 from 之前
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

  describe("setConvAutoDelete（v2）", () => {
    it("开启：先确认（非 destructive，单聊正文）；取消 → 不 PUT、不清理", async () => {
      vi.useFakeTimers(); vi.setSystemTime(NOW);
      const c = conv({ auto_delete_sec: 0 });
      const { client, opts } = setup({ askConfirm: vi.fn(async () => false) }, [c]);
      const { result } = renderHook(() => useAutoDelete(opts));
      let ok = true;
      await act(async () => { ok = await result.current.setConvAutoDelete(c, 86400); });
      expect(ok).toBe(false);
      expect(opts.askConfirm).toHaveBeenCalledTimes(1);
      const [msg, o] = (opts.askConfirm as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { danger?: boolean; okText?: string }];
      expect(o.danger).toBeFalsy();
      expect(o.okText).toBe("开启");
      expect(msg).toContain("对话双方");
      expect(client.updateConvSettings).not.toHaveBeenCalled();
      expect(client.removeMessagesLocal).not.toHaveBeenCalled();
    });
    it("群聊用 message_group 正文", async () => {
      const c = conv({ auto_delete_sec: 0, is_group: true });
      const { opts } = setup({}, [c]);
      const { result } = renderHook(() => useAutoDelete(opts));
      await act(async () => { await result.current.setConvAutoDelete(c, 86400); });
      expect((opts.askConfirm as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("群内所有成员");
    });
    it("确认后 PUT（其余开关原样回传）；回包 sec+from 一起覆盖，不追溯：不清任何历史", async () => {
      vi.useFakeTimers(); vi.setSystemTime(NOW);
      const c = conv({ auto_delete_sec: 0 });
      const { client, opts, state } = setup({}, [c]);
      client.updateConvSettings.mockResolvedValueOnce({ auto_delete_sec: 86400, auto_delete_from: NOW + 1 });
      const { result } = renderHook(() => useAutoDelete(opts));
      let ok = false;
      await act(async () => { ok = await result.current.setConvAutoDelete(c, 86400); });
      expect(ok).toBe(true);
      expect(client.updateConvSettings).toHaveBeenCalledWith("c1", { pinned_at: 5, muted: true, marked_unread: false, auto_delete_sec: 86400 });
      await flush();
      expect(state.convs[0].auto_delete_sec).toBe(86400);
      expect(state.convs[0].auto_delete_from).toBe(NOW + 1);
      expect(client.removeMessagesLocal).not.toHaveBeenCalled(); // 历史全在 from 之前
      expect(opts.refreshConversations).toHaveBeenCalled();
    });
    it("开启 / 缩短 / 放宽都弹一次说明；关闭、不变不弹", async () => {
      const c = conv({ auto_delete_sec: 604800 });
      const { opts } = setup({}, [c]);
      const { result } = renderHook(() => useAutoDelete(opts));
      await act(async () => { await result.current.setConvAutoDelete(c, 86400); });
      expect(opts.askConfirm).toHaveBeenCalledTimes(1);
      await act(async () => { await result.current.setConvAutoDelete(c, 2592000); });
      expect(opts.askConfirm).toHaveBeenCalledTimes(2);
      await act(async () => { await result.current.setConvAutoDelete(c, 0); });
      await act(async () => { await result.current.setConvAutoDelete(c, 604800); }); // 不变
      expect(opts.askConfirm).toHaveBeenCalledTimes(2);
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
    it("300204（非群主/管理员）→ toast autodel.group_admin_only、返回 false 供回滚", async () => {
      const c = conv({ auto_delete_sec: 0, is_group: true });
      const { client, opts } = setup({}, [c]);
      client.updateConvSettings.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: 300204 }));
      const { result } = renderHook(() => useAutoDelete(opts));
      let ok = true;
      await act(async () => { ok = await result.current.setConvAutoDelete(c, 86400); });
      expect(ok).toBe(false);
      expect(opts.setToast).toHaveBeenCalledWith("仅群主和管理员可以设置自动删除");
    });
  });

  it("conv_update 只有 from 变（sec 不变，对方重新生效）也触发扫描", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { client, opts } = setup({}, [conv({ auto_delete_sec: 86400, auto_delete_from: NOW })]); // from=NOW：什么都不过期
    const { result } = renderHook(() => useAutoDelete(opts));
    await flush();
    expect(client.removeMessagesLocal).not.toHaveBeenCalled();
    await act(async () => { result.current.applyConvUpdate({ conv_id: "c1", action: "settings", pinned_at: 0, muted: false, mute_until: 0, marked_unread: false, auto_delete_sec: 86400, auto_delete_from: 1 }); });
    await flush();
    expect(client.removeMessagesLocal).toHaveBeenCalledWith("c1", [1, 2, 3]);
  });

  it("conv_update：就地覆盖档位并立即清理（别的设备开启的场景）", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { client, opts, state } = setup({}, [conv({ auto_delete_sec: 0 })]);
    const { result } = renderHook(() => useAutoDelete(opts));
    await flush();
    expect(client.removeMessagesLocal).not.toHaveBeenCalled();
    await act(async () => { result.current.applyConvUpdate({ conv_id: "c1", action: "settings", pinned_at: 0, muted: false, mute_until: 0, marked_unread: false, auto_delete_sec: 86400, auto_delete_from: 1 }); });
    await flush();
    expect(state.convs[0].auto_delete_sec).toBe(86400);
    expect(state.convs[0].auto_delete_from).toBe(1);
    expect(client.removeMessagesLocal).toHaveBeenCalledWith("c1", [1, 2, 3]);
  });

  it("末条已过期但消息不在内存（刷新后墓碑过滤、缓存里还是旧预览）→ 预览置空、未读 0，并同步写会话缓存", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { client, opts, state } = setup({ msgsByConv: {} });
    const { rerender } = renderHook((o: UseAutoDeleteOptions) => useAutoDelete(o), { initialProps: opts });
    await flush();
    expect(state.convs[0].last_message).toBeNull();
    expect(state.convs[0].unread).toBe(0);
    rerender({ ...opts, conversations: state.convs });
    await flush();
    const cached = (client.cacheConversations.mock.calls as unknown as Conversation[][][]).at(-1)?.[0];
    expect(cached?.[0].last_message).toBeNull();
  });

  it("前台 30 秒扫描：预览那条到点（不在内存）也会被清掉", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const c = conv({ auto_delete_sec: 86400, last_message: { server_msg_id: "s", from: "u2", content_type: "text", content: "x", conv_seq: 3, timestamp: NOW - DAY + 20_000 } });
    const { opts, state } = setup({ msgsByConv: {} }, [c]);
    renderHook(() => useAutoDelete(opts));
    await flush();
    expect(state.convs[0].last_message).not.toBeNull();
    await act(async () => { vi.setSystemTime(NOW + 25_000); vi.advanceTimersByTime(SWEEP_INTERVAL_MS); await Promise.resolve(); await Promise.resolve(); });
    expect(state.convs[0].last_message).toBeNull();
  });

  it("列表刷新带回了已过期的旧预览（服务端时钟略慢 / 缓存）→ 下一轮扫描立刻再清", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const fresh = conv({ auto_delete_sec: 86400, last_message: null, unread: 0 });
    const { opts, state } = setup({ msgsByConv: {} }, [fresh]);
    const { rerender } = renderHook((o: UseAutoDeleteOptions) => useAutoDelete(o), { initialProps: opts });
    await flush();
    const stale = conv({ auto_delete_sec: 86400 }); // 预览 NOW-2天，已过期
    state.convs = [stale];
    rerender({ ...opts, conversations: [stale] });
    await flush();
    expect(state.convs[0].last_message).toBeNull();
  });

  it("别的设备经 conv_update 开启档位：不在内存的过期预览也立即清", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { opts, state } = setup({ msgsByConv: {} }, [conv({ auto_delete_sec: 0 })]);
    const { result } = renderHook(() => useAutoDelete(opts));
    await flush();
    expect(state.convs[0].last_message).not.toBeNull();
    act(() => { result.current.applyConvUpdate({ action: "settings", conv_id: "c1", auto_delete_sec: 86400, auto_delete_from: 1 } as never); });
    await flush();
    expect(state.convs[0].last_message).toBeNull();
    expect(state.convs).toHaveLength(1); // 会话行保留
  });
});
