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
    onMuteConv: vi.fn(),
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

  it("群聊行标 @我仍提醒", () => {
    const muted = [conv({ conv_id: "g1", muted: true, is_group: true, mention_unread: true })];
    setup({ conversations: muted });
    fireEvent.click(screen.getByText(t("notif.exceptions.web_row")));
    expect(screen.getByText(t("notif.exceptions.muted_mention"))).toBeTruthy();
    expect(screen.getByText(t("notif.row.group"), { exact: false })).toBeTruthy();
  });

  it("没有免打扰会话 → 只剩常驻的「添加例外」一行，不显示空态说明（同 iOS/Android；已拍板②：例外组不整组隐藏）", () => {
    setup({ conversations: [] });
    fireEvent.click(screen.getByText(t("notif.exceptions.web_row")));
    expect(screen.getByText(t("notif.exceptions.add"))).toBeTruthy();
    // 那两条空态文案是按手机端私聊/群聊分页写的（「私聊」「左滑」），本页私聊群聊合并、也没有左滑，借来用是错的。
    expect(screen.queryByText(t("notif.exceptions.empty_private"))).toBeNull();
    expect(document.querySelector(".settings-foot")).toBeNull();
  });
});

describe("NotificationsPanel：添加例外（P1 §2，复用 ForwardPicker 单选）", () => {
  it("点「添加例外」打开选择页，只列未免打扰的会话；脚注是合并 key pick_footer_all（不再拼接私聊/群聊两句）", () => {
    const convs = [
      conv({ conv_id: "c1", muted: false }),
      conv({ conv_id: "c2", muted: true }),
    ];
    setup({ conversations: convs });
    fireEvent.click(screen.getByText(t("notif.exceptions.web_row")));
    fireEvent.click(screen.getByText(t("notif.exceptions.add")));
    // .fwd-item-label 限定在选择页列表里——c2 本就在背后的「例外」列表中渲染（它是免打扰会话），
    // 不加选择器会命中那一份，而不是校验选择页本身有没有过滤它。
    expect(screen.getByText("label-c1", { selector: ".fwd-item-label" })).toBeTruthy();
    expect(screen.queryByText("label-c2", { selector: ".fwd-item-label" })).toBeNull(); // 已免打扰的不出现在选择页
    expect(screen.getByText(t("notif.exceptions.pick_footer_all"))).toBeTruthy();
  });

  // 定时免打扰（NOTIFICATIONS_P1_DESIGN §2/§4.1）：选完会话不直接永久免打扰，弹时长 Modal 再选。
  it("选中一行 → 弹时长 Modal（带会话名）；选「1 小时」→ onMuteConv(conv, ~1h 后) 并关闭 Modal", () => {
    const convs = [conv({ conv_id: "c1", muted: false })];
    const props = setup({ conversations: convs });
    fireEvent.click(screen.getByText(t("notif.exceptions.web_row")));
    fireEvent.click(screen.getByText(t("notif.exceptions.add")));
    fireEvent.click(screen.getByText("label-c1"));
    expect(props.onMuteConv).not.toHaveBeenCalled(); // 还没选时长，不该直接免打扰
    // 选择页已关闭（换成时长 Modal）
    expect(screen.queryByText(t("notif.exceptions.pick_footer_all"))).toBeNull();
    expect(screen.getByText(t("notif.mute.sheet_title", { name: "label-c1" }))).toBeTruthy();
    const before = Date.now();
    fireEvent.click(screen.getByText(t("mute.1h")));
    expect(props.onMuteConv).toHaveBeenCalledTimes(1);
    const [conv1, until] = props.onMuteConv.mock.calls[0];
    expect(conv1).toEqual(convs[0]);
    expect(until).toBeGreaterThanOrEqual(before + 3_600_000 - 2_000);
    expect(until).toBeLessThanOrEqual(before + 3_600_000 + 5_000);
    expect(screen.queryByText(t("notif.mute.sheet_title", { name: "label-c1" }))).toBeNull(); // Modal 已关
  });

  it("全部会话都已免打扰 → 选择页显示 pick_empty 空态", () => {
    const convs = [conv({ conv_id: "c1", muted: true })];
    setup({ conversations: convs });
    fireEvent.click(screen.getByText(t("notif.exceptions.web_row")));
    fireEvent.click(screen.getByText(t("notif.exceptions.add")));
    expect(screen.getByText(t("notif.exceptions.pick_empty"))).toBeTruthy();
  });
});

// 层叠回归（2026-09-30 用户报：选择页和聊天内容叠在一起）：面板在 .sidebar 里，弹窗留在原地会被
// 排在后面的 .main 整层压住。jsdom 不算层叠，只能守「弹窗挂到了 .app 根下、不在 .sidebar 里」这个结构前提。
describe("NotificationsPanel：添加例外的两个弹窗挂到 .app 根下（不留在侧栏的层叠上下文里）", () => {
  it("选择页与时长 Modal 的遮罩都是 .app 的直接子节点", () => {
    const app = document.createElement("div");
    app.className = "app";
    const sidebar = document.createElement("aside");
    sidebar.className = "sidebar";
    app.appendChild(sidebar);
    document.body.appendChild(app);
    try {
      const { unmount } = render(
        <NotificationsPanel
          settings={DEFAULT_NOTIFY_SETTINGS} isDesktop conversations={[conv({ conv_id: "c1" })]}
          convDisplayLabel={(c) => `label-${c.conv_id}`} convAvatarUrl={() => undefined}
          onSetPrivate={vi.fn()} onSetGroup={vi.fn()} onSetBadge={vi.fn()} onSetDesktop={vi.fn()}
          onUnmute={vi.fn()} onMuteConv={vi.fn()} onOpenConv={vi.fn()} onReset={vi.fn()} onBack={vi.fn()}
        />, { container: sidebar });
      fireEvent.click(screen.getByText(t("notif.exceptions.web_row")));
      fireEvent.click(screen.getByText(t("notif.exceptions.add")));
      const pickerMask = document.querySelector(".fwd-picker")!.parentElement!;
      expect(pickerMask.className).toBe("modal-mask");
      expect(pickerMask.parentElement).toBe(app);
      expect(sidebar.querySelector(".modal-mask")).toBeNull();

      fireEvent.click(screen.getByText("label-c1", { selector: ".fwd-item-label" }));
      const durationMask = document.querySelector(".mute-durations")!.closest(".modal-mask")!;
      expect(durationMask.parentElement).toBe(app);
      expect(sidebar.querySelector(".modal-mask")).toBeNull();
      unmount();
    } finally {
      app.remove();
    }
  });
});

// 定时免打扰（NOTIFICATIONS_P1_DESIGN §4.3）：例外列表按 isMutedNow 过滤 + 带到期文案。
describe("NotificationsPanel：例外列表的定时免打扰（§4.3）", () => {
  it("未到期 → 显示 muted_until 到期文案，仍在例外列表里", () => {
    const now = Date.now();
    const muted = [conv({ conv_id: "c1", muted: true, mute_until: now + 60_000 })];
    setup({ conversations: muted });
    fireEvent.click(screen.getByText(t("notif.exceptions.web_row")));
    expect(screen.getByText("label-c1")).toBeTruthy();
    // 具体文案（今天/明天/日期）依赖当前时刻分类，这里只断言不是恒定的「免打扰」纯文案，
    // 避免用例本身随运行时刻的日历日边界抖动。
    expect(screen.queryByText(t("notif.exceptions.muted"))).toBeNull();
  });

  it("已过期 → 视同未免打扰，从例外列表消失（不在 muted 计数/行内）", () => {
    const now = Date.now();
    const expired = [conv({ conv_id: "c1", muted: true, mute_until: now - 1 })];
    setup({ conversations: expired });
    // 主页入口计数应为 0（不含已过期）
    expect(screen.getByText("0")).toBeTruthy();
    fireEvent.click(screen.getByText(t("notif.exceptions.web_row")));
    expect(screen.queryByText("label-c1")).toBeNull();
  });
});
