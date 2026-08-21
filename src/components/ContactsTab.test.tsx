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

const services = { clientRef: { current: { friendAction: vi.fn(async () => {}) } } } as unknown as AppServices;
const friend = (over: Partial<FriendEntry> = {}): FriendEntry => ({ user_id: "u2", nickname: "小明", status: "accepted", updated_at: 1, ...over } as FriendEntry);
const user = (over: Partial<UserCard> = {}): UserCard => ({ user_id: "u9", nickname: "老王", tags: [], ...over } as UserCard);
function base(over: Partial<ContactsTabProps> = {}): ContactsTabProps {
  return {
    searchQ: "", setSearchQ: vi.fn(), doSearch: vi.fn(async () => {}), onScan: vi.fn(), contactEntries: [], contactsScrollRef: createRef<HTMLDivElement>(),
    searchResults: null, friendStatus: new Map(), labelOf: (id, n) => n || id, openFriendChat: vi.fn(), busyUser: null, doFriendAction: vi.fn(async () => {}),
    incoming: [], accepted: [], filteredAccepted: [], contactFilter: "", setContactFilter: vi.fn(), contactFilterQ: "", friendLabel: (f) => f.nickname || f.user_id,
    presence: {}, setFriendMenu: vi.fn(), ...over,
  };
}
const mount = (p: ContactsTabProps) => render(<AppServicesProvider value={services}><ContactsTab {...p} /></AppServicesProvider>);

describe("ContactsTab", () => {
  it("搜索框回车/按钮 → doSearch；扫一扫 → onScan", () => {
    const p = base();
    const { getByPlaceholderText, getByText, getByTitle } = mount(p);
    fireEvent.keyDown(getByPlaceholderText("对方完整 uid 或手机号"), { key: "Enter" });
    fireEvent.click(getByText("搜索"));
    expect(p.doSearch).toHaveBeenCalledTimes(2);
    fireEvent.click(getByTitle("扫一扫 / 我的二维码")); expect(p.onScan).toHaveBeenCalled();
  });
  it("搜索结果按好友状态出按钮：已是好友→发消息(openFriendChat)；陌生人→加好友(doFriendAction)；已申请置灰", () => {
    const p = base({ searchResults: [user({ user_id: "a" }), user({ user_id: "b" }), user({ user_id: "c" })], friendStatus: new Map([["a", "accepted"], ["b", undefined], ["c", "requested"]]) });
    const { getByText, getAllByText } = mount(p);
    fireEvent.click(getByText("发消息")); expect(p.openFriendChat).toHaveBeenCalledWith("a");
    fireEvent.click(getAllByText("加好友")[0]); expect(p.doFriendAction).toHaveBeenCalledWith("b", expect.any(Function));
    expect((getByText("已申请") as HTMLButtonElement).disabled).toBe(true);
  });
  it("新的朋友：同意/拒绝 → doFriendAction；空搜索结果显空态；好友计数 + 过滤框 → setContactFilter", () => {
    const p = base({ searchResults: [], incoming: [friend({ user_id: "p1", status: "pending" })], accepted: [friend(), friend({ user_id: "u3" })], filteredAccepted: [friend()], contactFilterQ: "明" });
    const { getByText, getByPlaceholderText } = mount(p);
    expect(getByText("没有找到匹配的用户")).toBeTruthy();
    fireEvent.click(getByText("同意")); fireEvent.click(getByText("拒绝"));
    expect(p.doFriendAction).toHaveBeenCalledTimes(2);
    expect(getByText(/好友（1\/2）/)).toBeTruthy();
    fireEvent.change(getByPlaceholderText("搜索好友"), { target: { value: "王" } }); expect(p.setContactFilter).toHaveBeenCalledWith("王");
  });
});
