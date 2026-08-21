// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach , afterEach } from "vitest";
import { renderHook, act , cleanup } from "@testing-library/react";
import { useAppearanceSettings } from "./useAppearanceSettings";
import { DEFAULT_WALLPAPER } from "./wallpaper";
afterEach(cleanup); // 多次 renderHook：卸载前一用例（CODING_STYLE §八）

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute("data-theme"); });
describe("useAppearanceSettings", () => {
  it("主题：写 <html data-theme> + 持久化；isDark 随 theme", () => {
    const { result } = renderHook(() => useAppearanceSettings(vi.fn()));
    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
    act(() => result.current.setTheme("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("im.theme")).toBe("dark");
    expect(result.current.isDark).toBe(true);
    act(() => result.current.setTheme("light")); expect(result.current.isDark).toBe(false);
  });
  it("字号/时间格式/发送键：写 CSS 变量 + 持久化；再次挂载从 localStorage 恢复", () => {
    const { result, unmount } = renderHook(() => useAppearanceSettings(vi.fn()));
    act(() => { result.current.setFontSize(18); result.current.setTimeFormat("12"); result.current.setSendKey("cmd"); });
    expect(document.documentElement.style.getPropertyValue("--msg-font")).toBe("18px");
    expect(localStorage.getItem("im.fontSize")).toBe("18"); expect(localStorage.getItem("im.timeFormat")).toBe("12"); expect(localStorage.getItem("im.sendKey")).toBe("cmd");
    unmount();
    const again = renderHook(() => useAppearanceSettings(vi.fn()));
    expect(again.result.current.fontSize).toBe(18); expect(again.result.current.timeFormat).toBe("12"); expect(again.result.current.sendKey).toBe("cmd");
  });
  it("壁纸：取色 clamp 并写色值壁纸；模糊写变量；reset 回默认；非图片文件 toast 拒绝", () => {
    const setToast = vi.fn();
    const { result } = renderHook(() => useAppearanceSettings(setToast));
    act(() => result.current.applyWallpaperColor({ h: 400, s: 2, v: -1 }));
    expect(result.current.colorHSV.h).toBe(360); expect(result.current.colorHSV.v).toBe(0); // h/v 越界被夹取（s 的默认上界由 color.clamp 决定，不在此断言）
    expect(result.current.wallpaper.kind).toBe("color");
    act(() => result.current.setWallpaperBlur(true));
    expect(document.documentElement.style.getPropertyValue("--wallpaper-blur")).toBe("10px");
    act(() => result.current.resetWallpaper());
    expect(result.current.wallpaper).toEqual(DEFAULT_WALLPAPER); expect(result.current.wallpaperBlur).toBe(false);
    act(() => result.current.pickWallpaperImage(new File(["x"], "a.txt", { type: "text/plain" })));
    expect(setToast).toHaveBeenCalledWith("请选择图片文件");
    act(() => result.current.openWallpaperColor()); expect(result.current.wallpaperColorOpen).toBe(true);
  });
});
