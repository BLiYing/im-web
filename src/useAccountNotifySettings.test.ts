// @vitest-environment jsdom
// useAccountNotifySettings（M5）：登录/重连的 迁移/覆盖/脏重试 判定接线 + 本地编辑即时生效并 PUT + 帧版本去重。
// 纯决策/wire 映射已在 notifySettingsSync.test.ts 覆盖；这里只测「调用时机对不对」这层胶水。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { createRef } from "react";
import type { MutableRefObject } from "react";
import { useAccountNotifySettings } from "./useAccountNotifySettings";
import { DEFAULT_NOTIFY_SETTINGS } from "./notifySettings";
import type { IMClient } from "./sdk/imSdk";

afterEach(cleanup); // 多次 renderHook：卸载前一用例（CODING_STYLE §八）
beforeEach(() => { localStorage.clear(); });

function fakeClient(over: Partial<IMClient> = {}) {
  return {
    notifySettings: vi.fn(async () => ({ version: 0, exists: false, settings: {} })),
    saveNotifySettings: vi.fn(async () => ({ version: 1, exists: true, settings: {} })),
    ...over,
  } as unknown as IMClient;
}

function mount(client: IMClient | null) {
  const clientRef = createRef<IMClient | null>() as MutableRefObject<IMClient | null>;
  clientRef.current = client;
  return { ...renderHook(() => useAccountNotifySettings({ clientRef })), clientRef };
}

describe("syncAfterLogin：exists=false → 迁移推送", () => {
  it("把当前本地默认值整体 PUT 上去，本地设置本身不变", async () => {
    const client = fakeClient({ notifySettings: vi.fn(async () => ({ version: 0, exists: false, settings: {} })) });
    const { result } = mount(client);
    await act(async () => { await result.current.syncAfterLogin(); });
    expect(client.saveNotifySettings).toHaveBeenCalledTimes(1);
    const wire = (client.saveNotifySettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(wire.private).toEqual({ enabled: true, preview: true, sound: "default" });
    expect(wire.badge).toEqual({ include_muted: false });
    expect(result.current.settings.private).toEqual(DEFAULT_NOTIFY_SETTINGS.private); // 迁移不覆盖本地
  });
});

describe("syncAfterLogin：exists=true → 服务端覆盖本地", () => {
  it("覆盖 private/group/badge，不调用 PUT", async () => {
    const client = fakeClient({
      notifySettings: vi.fn(async () => ({
        version: 5,
        exists: true,
        settings: {
          private: { enabled: false, preview: false, sound: "chime" },
          group: { enabled: true, preview: true, sound: "drop" },
          badge: { include_muted: true },
        },
      })),
    });
    const { result } = mount(client);
    await act(async () => { await result.current.syncAfterLogin(); });
    expect(client.saveNotifySettings).not.toHaveBeenCalled();
    expect(result.current.settings.private).toEqual({ enabled: false, preview: false, sound: "chime" });
    expect(result.current.settings.group).toEqual({ enabled: true, preview: true, sound: "drop" });
    expect(result.current.settings.badge).toEqual({ includeMuted: true });
  });
});

describe("本地编辑：立即生效 + PUT；失败标脏，下次登录改为重试推送而非 GET", () => {
  it("PUT 成功：saveNotifySettings 带上合并后的完整字段", async () => {
    const client = fakeClient();
    const { result } = mount(client);
    act(() => { result.current.setPrivate({ enabled: false }); });
    expect(result.current.settings.private.enabled).toBe(false); // 本地立即生效
    await act(async () => { await Promise.resolve(); }); // 让 pushAccountFields 的 microtask 走完
    expect(client.saveNotifySettings).toHaveBeenCalledTimes(1);
    const wire = (client.saveNotifySettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(wire.private).toEqual({ enabled: false, preview: true, sound: "default" });
  });

  it("PUT 失败 → 标脏；下次 syncAfterLogin 重试推送（不调用 GET），重试成功后清脏", async () => {
    const saveNotifySettings = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ version: 2, exists: true, settings: {} });
    const notifySettings = vi.fn(async () => ({ version: 0, exists: false, settings: {} }));
    const client = fakeClient({ saveNotifySettings, notifySettings });
    const { result } = mount(client);

    act(() => { result.current.setGroup({ sound: "chord" }); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); }); // 等失败的那次 PUT 落定

    // 下次登录：dirty=true → 应该重试推送，而不是先 GET。
    await act(async () => { await result.current.syncAfterLogin(); });
    expect(notifySettings).not.toHaveBeenCalled(); // 脏重试分支绝不先 GET
    expect(saveNotifySettings).toHaveBeenCalledTimes(2);

    // 重试成功后不再脏：再来一次 syncAfterLogin 应该走正常 GET 路径。
    await act(async () => { await result.current.syncAfterLogin(); });
    expect(notifySettings).toHaveBeenCalledTimes(1);
  });
});

describe("onServerVersionBump：只在帧版本比本地新时才重新 GET", () => {
  it("本地已是版本 5：收到 5 不重拉，收到 6 才重拉", async () => {
    localStorage.setItem("im.notif.sync.v1", JSON.stringify({ version: 5, dirty: false }));
    const notifySettings = vi.fn(async () => ({ version: 5, exists: true, settings: {} }));
    const client = fakeClient({ notifySettings });
    const { result } = mount(client);

    act(() => { result.current.onServerVersionBump(5); });
    await act(async () => { await Promise.resolve(); });
    expect(notifySettings).not.toHaveBeenCalled();

    act(() => { result.current.onServerVersionBump(6); });
    await act(async () => { await Promise.resolve(); });
    expect(notifySettings).toHaveBeenCalledTimes(1);
  });
});

describe("reset：本地回默认 + 把默认值推上去", () => {
  it("reset() 调 saveNotifySettings 带默认字段", async () => {
    const client = fakeClient();
    const { result } = mount(client);
    act(() => { result.current.setBadge({ includeMuted: true }); });
    await act(async () => { await Promise.resolve(); });
    (client.saveNotifySettings as ReturnType<typeof vi.fn>).mockClear();

    act(() => { result.current.reset(); });
    expect(result.current.settings.badge).toEqual(DEFAULT_NOTIFY_SETTINGS.badge);
    await act(async () => { await Promise.resolve(); });
    expect(client.saveNotifySettings).toHaveBeenCalledTimes(1);
    const wire = (client.saveNotifySettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(wire.badge).toEqual({ include_muted: false });
  });
});

describe("换账号登录：上一个账号的本地值与待补推标记不串到新账号", () => {
  it("A 有未送达的编辑，B 登录：不补推 A 的值，本地恢复默认，按 B 的服务端状态走", async () => {
    const saveNotifySettings = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue({ version: 1, exists: true, settings: {} });
    const notifySettings = vi.fn(async () => ({ version: 0, exists: false, settings: {} }));
    const client = fakeClient({ saveNotifySettings, notifySettings });
    const { result } = mount(client);

    await act(async () => { await result.current.syncAfterLogin("uidA"); }); // A 登录：迁移推送（第 1 次 PUT，失败→脏）
    act(() => { result.current.setGroup({ sound: "chord", enabled: false }); }); // A 的编辑（第 2 次 PUT）
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    saveNotifySettings.mockClear();
    saveNotifySettings.mockResolvedValue({ version: 1, exists: true, settings: {} });

    await act(async () => { await result.current.syncAfterLogin("uidB"); });
    expect(notifySettings).toHaveBeenCalled(); // B 不是补推分支，先 GET
    const pushed = saveNotifySettings.mock.calls.map((c) => c[0]);
    for (const wire of pushed) expect(wire.group).toEqual({ enabled: true, preview: true, sound: "default" }); // 迁移推的是默认值，不是 A 的
    expect(result.current.settings.group).toEqual(DEFAULT_NOTIFY_SETTINGS.group);
  });
});
