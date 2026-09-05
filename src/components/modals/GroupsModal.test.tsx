// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GroupsModal } from "./GroupsModal";
import type { GroupSummary } from "../../sdk/protocol";

afterEach(cleanup);

const g = (over: Partial<GroupSummary>): GroupSummary =>
  ({ conv_id: "g_1", name: "测试群", owner: "4820571639", avatar_url: "", created_at: 0, ...over });

const base = { uid: "1000000001", onCreate: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() };

describe("GroupsModal 群主副标题（内部 ID 零 UI 露出）", () => {
  it("别人的群显示群主昵称，不显示内部 ID", () => {
    const { container } = render(
      <GroupsModal {...base} groups={[g({ owner_nickname: "小明", owner_username: "xiaoming" })]} remarks={new Map()} />,
    );
    expect(screen.getByText("群主 小明")).toBeTruthy();
    expect(container.textContent).not.toContain("4820571639");
  });

  it("有备注时备注优先；资料全缺回落占位而非 uid", () => {
    const { container, rerender } = render(
      <GroupsModal {...base} groups={[g({ owner_nickname: "小明" })]} remarks={new Map([["4820571639", "老王"]])} />,
    );
    expect(screen.getByText("群主 老王")).toBeTruthy();
    rerender(<GroupsModal {...base} groups={[g({})]} remarks={new Map()} />);
    expect(screen.getByText("群主 未命名用户")).toBeTruthy();
    expect(container.textContent).not.toContain("4820571639");
  });

  it("自己是群主时仍显「我是群主」", () => {
    render(<GroupsModal {...base} groups={[g({ owner: "1000000001", owner_nickname: "我" })]} remarks={new Map()} />);
    expect(screen.getByText("我是群主")).toBeTruthy();
  });
});
