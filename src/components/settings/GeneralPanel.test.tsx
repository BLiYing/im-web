// @vitest-environment jsdom
//
// 通用设置里「全局快捷键」那一项。钉的是三条错了也不报错的：
//   · 浏览器版显示一个永远点不动的开关；
//   · 开关读的是偏好而不是真实状态（被占用时仍显示开）；
//   · 被占用时没有任何说明，用户只看到「点了开关又弹回去」。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { GeneralPanel } from "./GeneralPanel";

afterEach(cleanup);

type Props = Parameters<typeof GeneralPanel>[0];

function props(over: Partial<Props> = {}): Props {
  return {
    fontSize: 15, theme: "system", timeFormat: "24", sendKey: "enter",
    autoStart: false, autoStartSupported: false,
    globalShortcut: { enabled: false, label: "⌃⌘W" }, globalShortcutSupported: true,
    onFontSize: vi.fn(), onTheme: vi.fn(), onTimeFormat: vi.fn(), onSendKey: vi.fn(),
    onAutoStart: vi.fn(), onGlobalShortcut: vi.fn(), onOpenWallpaper: vi.fn(), onBack: vi.fn(),
    ...over,
  };
}

describe("GeneralPanel · 全局快捷键", () => {
  it("宿主不支持（浏览器）→ 整段不渲染", () => {
    const { queryByText } = render(<GeneralPanel {...props({ globalShortcutSupported: false })} />);
    expect(queryByText("全局快捷键")).toBeNull();
  });

  it("组合键写法还没读到（label 空串）→ 先不渲染，不显示「按  显示」这种半截文案", () => {
    const { queryByText } = render(<GeneralPanel {...props({ globalShortcut: { enabled: false, label: "" } })} />);
    expect(queryByText("全局快捷键")).toBeNull();
  });

  it("关着 → 显示组合键，点一下请求打开", () => {
    const p = props();
    const { getByText } = render(<GeneralPanel {...p} />);
    fireEvent.click(getByText("按 ⌃⌘W 显示 / 隐藏窗口"));
    expect(p.onGlobalShortcut).toHaveBeenCalledWith(true);
  });

  it("开着 → 点一下请求关闭", () => {
    const p = props({ globalShortcut: { enabled: true, label: "⌃⌘W" } });
    const { getByText } = render(<GeneralPanel {...p} />);
    fireEvent.click(getByText("按 ⌃⌘W 显示 / 隐藏窗口"));
    expect(p.onGlobalShortcut).toHaveBeenCalledWith(false);
  });

  it("被别的应用占用 → 开关是关着的，且副标题说明原因", () => {
    const { getByText, container } = render(
      <GeneralPanel {...props({ globalShortcut: { enabled: false, label: "⌃⌘W", taken: true } })} />);
    expect(getByText("⌃⌘W 已被其他应用占用，没能开启")).toBeTruthy();
    const row = getByText("按 ⌃⌘W 显示 / 隐藏窗口").closest(".radio-row")!;
    expect(row.querySelector(".radio-dot.on")).toBeNull();
    expect(container.textContent).not.toContain("默认关闭，以免");
  });
});
