// @vitest-environment jsdom
//
// 语言选择 + 切换后设置页立即换语言。钉的是：
//   · 选项用各语言自称（不随界面语言翻译）；
//   · 点选项 → onSelect(偏好值)；当前项高亮；
//   · setPref 后已渲染的面板**重渲染成新语言**（订阅生效，不是只在下次挂载时才换）；
//   · <html lang> 同步。
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguagePanel, LanguageSettings } from "./LanguagePanel";
import { GeneralPanel } from "./GeneralPanel";
import { getLang, getPref, setPref } from "../../i18n";

afterEach(() => { cleanup(); setPref("zh-Hans"); });

describe("LanguagePanel", () => {
  it("三个选项、当前项高亮、点击回调偏好值", () => {
    const onSelect = vi.fn();
    const { getByText, container } = render(<LanguagePanel pref="en" systemLabel="(auto)" onSelect={onSelect} onBack={vi.fn()} />);
    expect(getByText("跟随系统")).toBeTruthy();
    expect(getByText("简体中文")).toBeTruthy();
    expect(getByText("English")).toBeTruthy();
    expect(container.querySelectorAll(".radio-dot.on").length).toBe(1);
    fireEvent.click(getByText("English"));
    expect(onSelect).toHaveBeenCalledWith("en");
    fireEvent.click(getByText("跟随系统"));
    expect(onSelect).toHaveBeenCalledWith("system");
  });

  it("切到英文：已挂载的面板即刻换语言，自称不变，<html lang> 同步", () => {
    const { getByText, queryByText } = render(
      <GeneralPanel fontSize={15} theme="system" timeFormat="24" sendKey="enter" autoStart={false} autoStartSupported={false}
        globalShortcut={{ enabled: false, label: "" }} globalShortcutSupported={false}
        onFontSize={vi.fn()} onTheme={vi.fn()} onTimeFormat={vi.fn()} onSendKey={vi.fn()} onAutoStart={vi.fn()}
        onGlobalShortcut={vi.fn()} onOpenWallpaper={vi.fn()} onBack={vi.fn()} />,
    );
    expect(getByText("聊天壁纸")).toBeTruthy();
    act(() => setPref("en"));
    expect(getByText("Chat wallpaper")).toBeTruthy();
    expect(queryByText("聊天壁纸")).toBeNull();
    expect(getByText("Press Enter to send")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    act(() => setPref("zh-Hans"));
    expect(getByText("聊天壁纸")).toBeTruthy();
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("偏好变了但解析出的语言没变（显式语言 ↔ 跟随系统恰好同一种）：勾选仍要跟着动", () => {
    // 先停在「跟随系统」，再显式选成系统当前解析出的那种语言——界面语言全程不变，只有偏好在变。
    act(() => setPref("system"));
    const same = getLang();
    const { container } = render(<LanguageSettings onBack={vi.fn()} />);
    const rows = () => [...container.querySelectorAll(".radio-row")];
    const onIndex = () => rows().findIndex((r) => r.querySelector(".radio-dot.on"));
    expect(onIndex()).toBe(0);
    fireEvent.click(rows()[same === "zh-Hans" ? 1 : 2]);
    expect(getPref()).toBe(same);
    expect(onIndex()).toBe(same === "zh-Hans" ? 1 : 2);
    fireEvent.click(rows()[0]); // 点回「跟随系统」——修复前这一下界面毫无反应
    expect(getPref()).toBe("system");
    expect(onIndex()).toBe(0);
  });
});
