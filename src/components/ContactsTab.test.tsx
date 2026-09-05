// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { createRef } from "react";
afterEach(cleanup);
// VirtualList 依赖 ResizeObserver 测量滚动父，jsdom 无此 API → 打桩（好友行渲染不在本测断言范围）。
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
import { AppServicesProvider, type AppServices } from "../AppServicesContext";
import { ContactsTab, type ContactsTabProps } from "./ContactsTab";
import type { FriendEntry, UserCard } from "../sdk/protocol";

const askFriendRequest = vi.fn();
const services = { clientRef: { current: { friendAction: vi.fn(async () => {}) } }, askFriendRequest } as unknown as AppServices;
const friend = (over: Partial<FriendEntry> = {}): FriendEntry => ({ user_id: "u2", nickname: "小明", status: "accepted", updated_at: 1, ...over } as FriendEntry);
const user = (over: Partial<UserCard> = {}): UserCard => ({ user_id: "u9", nickname: "老王", tags: [], ...over } as UserCard);
function base(over: Partial<ContactsTabProps> = {}): ContactsTabProps {
  return {
    searchQ: "", setSearchQ: vi.fn(), doSearch: vi.fn(async () => {}), onScan: vi.fn(), contactEntries: [], contactsScrollRef: createRef<HTMLDivElement>(),
    searchResults: null, friendStatus: new Map(), labelOf: (id, n) => n || id, openFriendChat: vi.fn(), busyUser: null, doFriendAction: vi.fn(async () => {}),
    accepted: [], filteredAccepted: [], contactFilter: "", setContactFilter: vi.fn(), contactFilterQ: "", friendLabel: (f) => f.nickname || f.user_id,
    presence: {}, setFriendMenu: vi.fn(), ...over,
  };
}
const mount = (p: ContactsTabProps) => render(<AppServicesProvider value={services}><ContactsTab {...p} /></AppServicesProvider>);

describe("ContactsTab", () => {
  // 内部 ID 零 UI 露出（docs/UI.md「用户标识」）：好友行副标题必须是 @句柄，
  // 曾经显示的是 f.user_id——账号重构后那是 10 位随机数字。
  it("好友行副标题显示 @username，不显示内部 ID", () => {
    const p = base({ accepted: [friend({ user_id: "4820571639", username: "xiaoming", nickname: "小明" })],
                     filteredAccepted: [friend({ user_id: "4820571639", username: "xiaoming", nickname: "小明" })] });
    const { getByText, queryByText } = mount(p);
    expect(getByText("@xiaoming")).toBeTruthy();
    expect(queryByText("4820571639")).toBeNull();
  });

  // 没有句柄时副标题留空——不显示"未设置"，更不回退到内部 ID。
  it("没有 username 时副标题不显示任何 ID", () => {
    const p = base({ accepted: [friend({ user_id: "4820571639", nickname: "小明" })],
                     filteredAccepted: [friend({ user_id: "4820571639", nickname: "小明" })] });
    const { queryByText } = mount(p);
    expect(queryByText("4820571639")).toBeNull();
  });

  // 待办数走 .row-badge（红底胶囊），不走 .row-value（灰色小字，语义是"当前值"）。
  // 早先用 value 渲染，「新的朋友 3」跟设置页的「字号 中」长得一模一样，一眼扫过去不像有待办。
  it("入口行的待确认数渲染成红色徽标而非灰色右值", () => {
    const p = base({ contactEntries: [
      { id: "friendRequests", label: "新的朋友", chevron: true, badge: "3", onClick: vi.fn() },
    ] });
    const { container, getByText } = mount(p);
    const badge = getByText("3");
    expect(badge.className).toBe("row-badge");
    expect(container.querySelector(".row-value")).toBeNull();
  });

  it("搜索框回车/按钮 → doSearch；扫一扫 → onScan", () => {
    const p = base();
    const { getByPlaceholderText, getByText, getByTitle } = mount(p);
    fireEvent.keyDown(getByPlaceholderText("对方用户名或手机号"), { key: "Enter" });
    fireEvent.click(getByText("搜索"));
    expect(p.doSearch).toHaveBeenCalledTimes(2);
    fireEvent.click(getByTitle("扫一扫 / 我的二维码")); expect(p.onScan).toHaveBeenCalled();
  });
  // 「加好友」不再直接发请求：走全站统一的申请弹窗填验证消息（2026-09-05）。
  it("搜索结果按好友状态出按钮：已是好友→发消息(openFriendChat)；陌生人→加好友(开申请弹窗)；已申请置灰", () => {
    const p = base({ searchResults: [user({ user_id: "a" }), user({ user_id: "b", nickname: "老王" }), user({ user_id: "c" })], friendStatus: new Map([["a", "accepted"], ["b", undefined], ["c", "requested"]]) });
    const { getByText, getAllByText } = mount(p);
    fireEvent.click(getByText("发消息")); expect(p.openFriendChat).toHaveBeenCalledWith("a");
    fireEvent.click(getAllByText("加好友")[0]);
    expect(askFriendRequest).toHaveBeenCalledWith("b", "老王"); // 带显示名，弹窗里要显示"发送给 X"
    expect(p.doFriendAction).not.toHaveBeenCalled();            // 不再绕过弹窗直接发
    expect((getByText("已申请") as HTMLButtonElement).disabled).toBe(true);
  });
  // 「新的朋友」已移出本组件（→ 顶部入口行 + FriendRequestsModal）：这里只剩空态与好友计数。
  it("空搜索结果显空态；好友计数 + 过滤框 → setContactFilter；不再内联渲染新的朋友", () => {
    const p = base({ searchResults: [], accepted: [friend(), friend({ user_id: "u3" })], filteredAccepted: [friend()], contactFilterQ: "明" });
    const { getByText, queryByText, getByPlaceholderText } = mount(p);
    expect(getByText("没有找到匹配的用户")).toBeTruthy();
    expect(queryByText("同意")).toBeNull();
    expect(getByText(/好友（1\/2）/)).toBeTruthy();
    fireEvent.change(getByPlaceholderText("搜索好友"), { target: { value: "王" } }); expect(p.setContactFilter).toHaveBeenCalledWith("王");
  });
});
