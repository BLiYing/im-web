// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JoinRequestsModal } from "../QRUI";
import type { JoinRequest } from "../sdk/protocol";

afterEach(cleanup);
const req = (o: Partial<JoinRequest>): JoinRequest =>
  ({ user_id: "a", nickname: "A", avatar_url: "", hello: "附言", status: "pending", created_at: 1, ...o });

describe("JoinRequestsModal 邀请人", () => {
  it("有 inviterNickname → 显示「由 X 邀请」并替代附言", () => {
    render(<JoinRequestsModal requests={[req({ inviterNickname: "张三" })]} loading={false} onDecide={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("由 张三 邀请")).toBeInTheDocument();
    expect(screen.queryByText("附言")).toBeNull();
  });
  it("无 inviterNickname → 仍显示附言", () => {
    render(<JoinRequestsModal requests={[req({})]} loading={false} onDecide={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("附言")).toBeInTheDocument();
  });
});
