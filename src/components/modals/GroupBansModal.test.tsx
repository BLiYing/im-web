// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GroupBansModal } from "./GroupBansModal";
import type { GroupBan } from "../../sdk/protocol";

afterEach(cleanup);

const ban = (over: Partial<GroupBan>): GroupBan =>
  ({ user_id: "4820571639", banned_by: "1000000001", banned_at: 0, expires_at: 0, ...over });

describe("GroupBansModal 显示名（内部 ID 零 UI 露出）", () => {
  it("主标题走 备注 → 昵称 → @username，副标题带 @username", () => {
    render(<GroupBansModal bans={[ban({ nickname: "小明", username: "xiaoming" })]} remarks={new Map()} onUnban={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("小明")).toBeTruthy();
    expect(screen.getByText(/@xiaoming/)).toBeTruthy();
  });

  it("有备注时备注优先", () => {
    render(<GroupBansModal bans={[ban({ nickname: "小明", username: "xiaoming" })]} remarks={new Map([["4820571639", "老王"]])} onUnban={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("老王")).toBeTruthy();
  });

  // 这条是本次 bug 的回归闸：老代码直接渲染 b.user_id。
  it("任何情况下都不把内部 ID 渲染出来（资料全缺也只回落占位）", () => {
    const { container } = render(<GroupBansModal bans={[ban({})]} remarks={new Map()} onUnban={vi.fn()} onClose={vi.fn()} />);
    expect(container.textContent).not.toContain("4820571639");
    expect(screen.getByText("未命名用户")).toBeTruthy();
  });

  it("解除按钮回传的仍是 user_id（它是接口参数，不是展示物）", () => {
    const onUnban = vi.fn();
    render(<GroupBansModal bans={[ban({ nickname: "小明" })]} remarks={new Map()} onUnban={onUnban} onClose={vi.fn()} />);
    screen.getByText("解除").click();
    expect(onUnban).toHaveBeenCalledWith("4820571639");
  });
});
