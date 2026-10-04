// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { installPowerSaving, usePowerSaveToast } from "./usePowerSaving";
import { reloadPowerSaveStoreForTest, resetPowerSaveStoreForTest, setPowerBattery, setPowerPref } from "./powerSaveStore";
import { t } from "./i18n";

beforeEach(() => { localStorage.clear(); resetPowerSaveStoreForTest(); document.documentElement.className = ""; });
afterEach(cleanup);

installPowerSaving(); // 模块级一次，与 main.tsx 相同

describe("installPowerSaving / usePowerSaveToast", () => {
  it("省电生效 → 根节点 no-anim + no-blur；退出 → 摘掉", () => {
    const root = document.documentElement;
    expect(root.classList.contains("no-anim")).toBe(false);
    act(() => setPowerPref("mode", "always"));
    expect(root.classList.contains("no-anim") && root.classList.contains("no-blur")).toBe(true);
    act(() => setPowerPref("mode", "off"));
    expect(root.classList.contains("no-anim") || root.classList.contains("no-blur")).toBe(false);
  });
  it("用户单独关动画 / 毛玻璃 → 对应 class（不依赖省电）", () => {
        act(() => setPowerPref("blur", false));
    expect(document.documentElement.classList.contains("no-blur")).toBe(true);
    expect(document.documentElement.classList.contains("no-anim")).toBe(false);
  });
  it("auto 低电量：弹一次带阈值的 Toast；始终开启不弹；充电后下一周期再弹", () => {
    const toast = vi.fn();
    renderHook(() => usePowerSaveToast(toast));
    act(() => setPowerPref("mode", "always"));
    expect(toast).not.toHaveBeenCalled();
    act(() => setPowerPref("mode", "auto"));
    act(() => setPowerBattery({ supported: true, level: 10, charging: false }));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(t("power_saving.auto_on_toast", { percent: 15 }));
    act(() => setPowerBattery({ supported: true, level: 9, charging: false }));
    expect(toast).toHaveBeenCalledTimes(1);
    act(() => setPowerBattery({ supported: true, level: 9, charging: true }));
    act(() => setPowerBattery({ supported: true, level: 9, charging: false }));
    expect(toast).toHaveBeenCalledTimes(2);
  });
  it("宿主重挂载（退出→登录）不重置每周期一次的记忆：已弹过不再弹", () => {
    const toast = vi.fn();
    const a = renderHook(() => usePowerSaveToast(toast));
    act(() => setPowerPref("mode", "auto"));
    act(() => setPowerBattery({ supported: true, level: 10, charging: false }));
    expect(toast).toHaveBeenCalledTimes(1);
    a.unmount();
    renderHook(() => usePowerSaveToast(toast));
    expect(toast).toHaveBeenCalledTimes(1);
  });
  it("始终开启 → 切到 auto（已生效、不是上升沿）不弹", () => {
    const toast = vi.fn();
    renderHook(() => usePowerSaveToast(toast));
    act(() => setPowerBattery({ supported: true, level: 10, charging: false }));
    act(() => setPowerPref("mode", "always"));
    act(() => setPowerPref("mode", "auto"));
    expect(toast).not.toHaveBeenCalled();
  });
  it("刷新页面后电量仍低：不重复弹（已提示记忆来自 localStorage）", () => {
    const toast = vi.fn();
    const a = renderHook(() => usePowerSaveToast(toast));
    act(() => setPowerPref("mode", "auto"));
    act(() => setPowerBattery({ supported: true, level: 10, charging: false }));
    expect(toast).toHaveBeenCalledTimes(1);
    a.unmount();
    reloadPowerSaveStoreForTest(); // 模拟刷新：内存清空，localStorage 保留
    renderHook(() => usePowerSaveToast(toast));
    act(() => setPowerBattery({ supported: true, level: 10, charging: false }));
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
