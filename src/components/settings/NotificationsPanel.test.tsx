// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NotificationsPanel } from "./NotificationsPanel";
import { DEFAULT_NOTIFY_SETTINGS, type NotifySettings } from "../../notifySettings";
import { t } from "../../i18n";
import type { Conversation } from "../../sdk/protocol";

vi.mock("../../alertPlayer", () => ({ previewAlertSound: vi.fn() }));
import { previewAlertSound } from "../../alertPlayer";

afterEach(cleanup);

const conv = (over: Partial<Conversation>): Conversation =>
  ({ conv_id: "c1", peer: "u2", unread: 0, is_group: false, muted: false, ...over } as Conversation);

function setup(over: Partial<{ settings: NotifySettings; isDesktop: boolean; conversations: Conversation[] }> = {}) {
  const props = {
    settings: over.settings ?? DEFAULT_NOTIFY_SETTINGS,
    isDesktop: over.isDesktop ?? true,
    conversations: over.conversations ?? [],
    convDisplayLabel: (c: Conversation) => `label-${c.conv_id}`,
    convAvatarUrl: () => undefined,
    onSetPrivate: vi.fn(),
    onSetGroup: vi.fn(),
    onSetBadge: vi.fn(),
    onSetDesktop: vi.fn(),
    onUnmute: vi.fn(),
    onOpenConv: vi.fn(),
    onReset: vi.fn(),
    onBack: vi.fn(),
  };
  render(<NotificationsPanel {...props} />);
  return props;
}

describe("NotificationsPanel：主页", () => {
  it("渲染标题与各分组标签", () => {
    setup();
    expect(screen.getByText(t("settings.row.notifications"))).toBeTruthy();
    expect(screen.getByText(t("notif.section.message"))).toBeTruthy();
    expect(screen.getByText(t("notif.section.badge"))).toBeTruthy();
  });

  it("切换「私聊通知」开关 → 调用 onSetPrivate({enabled:false})", () => {
    const props = setup();
    fireEvent.click(screen.getByText(t("notif.row.private")).closest("label")!.querySelector("input")!);
    expect(props.onSetPrivate).toHaveBeenCalledWith({ enabled: false });
  });

  it("切换「包含免打扰会话」→ 调用 onSetBadge", () => {
    const props = setup();
    fireEvent.click(screen.getByText(t("notif.badge.include_muted")).closest("label")!.querySelector("input")!);
    expect(props.onSetBadge).toHaveBeenCalledWith({ includeMuted: true });
  });

  it("选提示音 → 调用 onSetGroup({sound}) 并试听一次", () => {
    const props = setup();
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    // 两个 <select>：私聊在前、群聊在后（渲染顺序）。
    fireEvent.change(selects[1], { target: { value: "chime" } });
    expect(props.onSetGroup).toHaveBeenCalledWith({ sound: "chime" });
    expect(previewAlertSound).toHaveBeenCalledWith("chime", DEFAULT_NOTIFY_SETTINGS.desktop.volume);
  });

  it("音量滑杆：拖动过程（change，React 对 range 就是这么绑的）只刷新本地数字，松手（mouseup）才提交 + 试听", () => {
    const props = setup();
    const range = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(range, { target: { value: "3" } });
    expect(props.onSetDesktop).not.toHaveBeenCalled();
    expect(range.value).toBe("3"); // 本地显示已经跟着拖动更新
    fireEvent.mouseUp(range, { target: { value: "3" } });
    expect(props.onSetDesktop).toHaveBeenCalledWith({ volume: 3 });
    expect(previewAlertSound).toHaveBeenCalledWith("default", 3);
  });

  it("点击「重置所有通知设置」→ 调用 onReset", () => {
    const props = setup();
    fireEvent.click(screen.getByText(t("notif.reset")));
    expect(props.onReset).toHaveBeenCalled();
  });

  it("浏览器构建（isDesktop=false）：桌面通知行降级占位，播放提示音行文案换成「应用内提示音」", () => {
    setup({ isDesktop: false });
    expect(screen.getByText(t("notif.desktop.browser_only"))).toBeTruthy();
    expect(screen.getByText(t("notif.in_app.sound"))).toBeTruthy();
    expect(screen.queryByText(t("notif.desktop.sound"))).toBeNull();
  });
});

describe("NotificationsPanel：免打扰的会话（例外列表）", () => {
  it("行数与主页角标一致；点行进入会话，点「取消免打扰」只触发 onUnmute 不进会话", () => {
    const muted = [conv({ conv_id: "c1", muted: true, is_group: false })];
    const props = setup({ conversations: muted });
    // 主页入口显示计数
    expect(screen.getByText("1")).toBeTruthy();
    fireEvent.click(screen.getByText(t("notif.exceptions.web_row")));
    // 进入例外列表
    expect(screen.getByText("label-c1")).toBeTruthy();
    fireEvent.click(screen.getByText(t("web.conv.menu.unmute")));
    expect(props.onUnmute).toHaveBeenCalledWith(muted[0]);
    expect(props.onOpenConv).not.toHaveBeenCalled();
    // 点行本身（非按钮区域）→ 进入该会话
    fireEvent.click(screen.getByText("label-c1"));
    expect(props.onOpenConv).toHaveBeenCalledWith("c1");
  });

  it("群聊行标 @我仍提醒；空列表显示空态文案", () => {
    const muted = [conv({ conv_id: "g1", muted: true, is_group: true, mention_unread: true })];
    setup({ conversations: muted });
    fireEvent.click(screen.getByText(t("notif.exceptions.web_row")));
    expect(screen.getByText(t("notif.exceptions.muted_mention"))).toBeTruthy();
    expect(screen.getByText(t("notif.row.group"), { exact: false })).toBeTruthy();
  });

  it("没有免打扰会话 → 空态文案", () => {
    setup({ conversations: [] });
    fireEvent.click(screen.getByText(t("notif.exceptions.web_row")));
    expect(screen.getByText(t("notif.exceptions.empty_private"))).toBeTruthy();
  });
});
