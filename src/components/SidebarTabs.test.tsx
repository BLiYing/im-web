// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { SidebarTabs, type SidebarTabsProps } from "./SidebarTabs";
import type { Conversation } from "../sdk/protocol";
afterEach(cleanup);

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  conv_id: "c1", peer: "u2", last_message: null, latest_conv_seq: 0, unread: 0, read_seq: 0, peer_read_seq: 0, ...over,
} as Conversation);

function mount(over: Partial<SidebarTabsProps> = {}) {
  const props: SidebarTabsProps = {
    tab: "chats", conversations: [], incomingCount: 0, onChats: vi.fn(), onContacts: vi.fn(), ...over,
  };
  return { props, ...render(<SidebarTabs {...props} />) };
}

describe("SidebarTabs", () => {
  // 三端统一叫「消息」（2026-09-15，此前 Web/iOS 叫「会话」、Android 叫「消息」）
  it("第一个页签叫「消息」", () => {
    const { getByRole, queryByText } = mount();
    expect(getByRole("button", { name: /消息/ })).toBeTruthy();
    expect(queryByText("会话")).toBeNull();
  });

  it("全部已读时不亮蓝点", () => {
    const { container } = mount({ conversations: [conv(), conv({ conv_id: "c2" })] });
    expect(container.querySelector(".tab-dot")).toBeNull();
  });

  it("有未读就在「消息」页签上亮蓝点", () => {
    const { container, getByRole } = mount({ conversations: [conv({ unread: 3 })] });
    const dot = container.querySelector(".tab-dot");
    expect(dot).not.toBeNull();
    expect(getByRole("button", { name: /消息/ }).contains(dot)).toBe(true);
  });

  // 与 badgeCountOf / Android TabUnread / iOS IMTabUnreadCount 同口径
  it("只有免打扰会话有未读时不亮；免打扰里被 @ 仍亮", () => {
    expect(mount({ conversations: [conv({ unread: 9, muted: true })] }).container.querySelector(".tab-dot")).toBeNull();
    cleanup();
    expect(mount({ conversations: [conv({ unread: 9, muted: true, mention_unread: true })] })
      .container.querySelector(".tab-dot")).not.toBeNull();
  });

  it("好友申请数照旧显示在「通讯录」页签，点页签回调各自的切换", () => {
    const { getByRole, props } = mount({ incomingCount: 2 });
    const contacts = getByRole("button", { name: /通讯录/ });
    expect(contacts.textContent).toContain("2");
    fireEvent.click(contacts);
    fireEvent.click(getByRole("button", { name: /消息/ }));
    expect(props.onContacts).toHaveBeenCalledTimes(1);
    expect(props.onChats).toHaveBeenCalledTimes(1);
  });
});
