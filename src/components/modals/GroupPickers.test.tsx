// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CreateGroupModal } from "./CreateGroupModal";
import { InviteMembersModal } from "./InviteMembersModal";
import type { FriendEntry } from "../../sdk/protocol";

afterEach(cleanup);

const f = (id: string, nickname: string, remark?: string): FriendEntry =>
  ({ user_id: id, nickname, remark, status: "accepted", updated_at: 0, blocked: false } as FriendEntry);
// 与全站一致的显示名口径：备注 > 昵称 > uid。
const friendLabel = (x: FriendEntry) => (x.remark?.trim() || x.nickname?.trim() || x.user_id);
const friends = [f("1001", "Alice", "老王"), f("1002", "Bob"), f("1003", "Carol")];

describe("InviteMembersModal 搜索", () => {
  const base = { selected: [], candidates: friends, friendLabel, onToggle: vi.fn(), onInvite: vi.fn(), onCancel: vi.fn() };

  it("按显示名（含备注）收窄；无命中显「没有匹配的好友」", () => {
    render(<InviteMembersModal {...base} />);
    const box = screen.getByLabelText("搜索好友");
    fireEvent.change(box, { target: { value: "老王" } });
    expect(screen.getByText("老王", { selector: ".row-label" })).toBeTruthy(); // 1001 的显示名就是备注
    expect(screen.queryByText("Bob", { selector: ".row-label" })).toBeNull();
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText("没有匹配的好友")).toBeTruthy();
  });

  it("候选为空时不渲染搜索框，仍显原空态文案", () => {
    render(<InviteMembersModal {...base} candidates={[]} />);
    expect(screen.queryByLabelText("搜索好友")).toBeNull();
    expect(screen.getByText("好友都已在群里了")).toBeTruthy();
  });
});

describe("CreateGroupModal 搜索与全选", () => {
  const base = {
    draft: { name: "", selected: [] as string[] }, accepted: friends, friendLabel,
    busy: false, maxInitialMembers: 10, onChange: vi.fn(), onCreate: vi.fn(), onCancel: vi.fn(),
  };

  it("无搜索词时「全选」= 选中全部（与加搜索前行为一致）", () => {
    const onChange = vi.fn();
    render(<CreateGroupModal {...base} onChange={onChange} />);
    fireEvent.click(screen.getByText("全选"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected: ["1001", "1002", "1003"] }));
  });

  // 搜了「张」还去勾上没显示的两百人，用户不会预期——全选只作用于当前可见行。
  it("有搜索词时「全选」只并上可见行，已选的人不被清掉", () => {
    const onChange = vi.fn();
    render(<CreateGroupModal {...base} draft={{ name: "", selected: ["1003"] }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("搜索好友"), { target: { value: "老王" } });
    fireEvent.click(screen.getByText("全选"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected: ["1003", "1001"] }));
  });

  it("有搜索词时「取消全选」只摘掉可见行，不动被过滤掉的已选", () => {
    const onChange = vi.fn();
    render(<CreateGroupModal {...base} draft={{ name: "", selected: ["1001", "1003"] }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("搜索好友"), { target: { value: "老王" } });
    expect(screen.getByText("取消全选")).toBeTruthy(); // 可见行已全部选中
    fireEvent.click(screen.getByText("取消全选"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected: ["1003"] }));
  });

  it("全选并集仍受 maxInitialMembers 上限截断", () => {
    const onChange = vi.fn();
    render(<CreateGroupModal {...base} maxInitialMembers={2} onChange={onChange} />);
    fireEvent.click(screen.getByText("全选"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected: ["1001", "1002"] }));
  });
});
