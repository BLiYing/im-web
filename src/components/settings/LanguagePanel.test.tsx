// @vitest-environment jsdom
//
// 语言选择 + 切换后设置页立即换语言。钉的是：
//   · 选项用各语言自称（不随界面语言翻译）；
//   · 点选项 → onSelect(偏好值)；当前项高亮；
//   · setPref 后已渲染的面板**重渲染成新语言**（订阅生效，不是只在下次挂载时才换）；
//   · <html lang> 同步。
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguagePanel } from "./LanguagePanel";
import { GeneralPanel } from "./GeneralPanel";
import { setPref } from "../../i18n";

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
});
