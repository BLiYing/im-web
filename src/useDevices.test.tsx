// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useDevices } from "./useDevices";
import type { IMClient } from "./sdk/imSdk";
import type { DeviceView } from "./sdk/protocol";

afterEach(cleanup);

const dev = (over: Partial<DeviceView> = {}): DeviceView => ({
  session_id: "sid-1", platform: "web", device_name: "Chrome", created_at: 1, last_active_at: 2,
  online: true, current: false, ...over,
});

/** 造一个只带设备三方法的假 IMClient + 注入依赖。askConfirm 默认放行。 */
function setup(over: { listDevices?: () => Promise<DeviceView[]>; confirm?: boolean } = {}) {
  const client = {
    listDevices: vi.fn(over.listDevices ?? (async () => [dev()])),
    revokeDevice: vi.fn(async (_sid: string) => {}),
    revokeOtherDevices: vi.fn(async () => {}),
  };
  const clientRef = { current: client as unknown as IMClient };
  const askConfirm = vi.fn(async () => over.confirm ?? true);
  const setToast = vi.fn();
  const hook = renderHook(() => useDevices({ clientRef, askConfirm, setToast }));
  return { hook, client, askConfirm, setToast };
}

describe("useDevices", () => {
  it("loadDevices：成功回填列表", async () => {
    const { hook } = setup();
    expect(hook.result.current.devices).toBeNull(); // 初始=加载中
    await act(() => hook.result.current.loadDevices());
    expect(hook.result.current.devices).toHaveLength(1);
    expect(hook.result.current.devicesErr).toBe("");
  });

  it("loadDevices：失败落空列表 + 错误文案", async () => {
    const { hook } = setup({ listDevices: async () => { throw new Error("网络断了"); } });
    await act(() => hook.result.current.loadDevices());
    expect(hook.result.current.devices).toEqual([]);
    expect(hook.result.current.devicesErr).toBe("网络断了");
  });

  it("revokeDevice：本机直接 return，不弹确认", async () => {
    const { hook, client, askConfirm } = setup();
    await act(() => hook.result.current.revokeDevice(dev({ current: true })));
    expect(askConfirm).not.toHaveBeenCalled();
    expect(client.revokeDevice).not.toHaveBeenCalled();
  });

  it("revokeDevice：确认后调用 SDK + 吐司 + 重拉列表，busy 态复位", async () => {
    const { hook, client, setToast } = setup();
    await act(() => hook.result.current.revokeDevice(dev({ session_id: "sid-2" })));
    expect(client.revokeDevice).toHaveBeenCalledWith("sid-2");
    expect(setToast).toHaveBeenCalledWith("已退出该设备");
    expect(client.listDevices).toHaveBeenCalled(); // 踢完重拉
    expect(hook.result.current.revokingSid).toBe("");
  });

  it("revokeDevice：确认框点取消则不动 SDK", async () => {
    const { hook, client } = setup({ confirm: false });
    await act(() => hook.result.current.revokeDevice(dev()));
    expect(client.revokeDevice).not.toHaveBeenCalled();
  });

  it("revokeOtherDevices：确认后调用 SDK + 吐司；失败走失败吐司且 busy 复位", async () => {
    const { hook, client, setToast } = setup();
    await act(() => hook.result.current.revokeOtherDevices());
    expect(client.revokeOtherDevices).toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith("已退出其他所有设备");

    client.revokeOtherDevices.mockRejectedValueOnce(new Error("500"));
    await act(() => hook.result.current.revokeOtherDevices());
    expect(setToast).toHaveBeenCalledWith("操作失败：500");
    expect(hook.result.current.revokingSid).toBe("");
  });

  it("resetDevices：清列表 + 关面板（logout 复位）", async () => {
    const { hook } = setup();
    await act(() => hook.result.current.loadDevices());
    act(() => hook.result.current.setDevicesOpen(true));
    act(() => hook.result.current.resetDevices());
    expect(hook.result.current.devices).toBeNull();
    expect(hook.result.current.devicesOpen).toBe(false);
  });
});
