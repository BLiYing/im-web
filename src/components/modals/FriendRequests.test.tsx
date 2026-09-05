// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FriendRequestModal, MAX_FRIEND_HELLO } from "./FriendRequestModal";
import { FriendRequestsModal } from "./FriendRequestsModal";
import type { FriendEntry } from "../../sdk/protocol";

afterEach(cleanup);

const f = (over: Partial<FriendEntry>): FriendEntry =>
  ({ user_id: "u2", nickname: "小明", status: "pending", updated_at: 1, avatar_url: "", ...over } as FriendEntry);
const label = (x: FriendEntry) => x.nickname || x.user_id;

describe("FriendRequestModal（发申请时填验证消息）", () => {
  it("预填默认理由，改完发出的是 trim 后的文本", () => {
    const onSend = vi.fn();
    render(<FriendRequestModal name="小明" defaultHello="我是老王" busy={false} onSend={onSend} onClose={vi.fn()} />);
    const box = screen.getByLabelText(/验证消息/) as HTMLTextAreaElement;
    expect(box.value).toBe("我是老王");
    fireEvent.change(box, { target: { value: "  同事，加一下  " } });
    fireEvent.click(screen.getByText("发送申请"));
    expect(onSend).toHaveBeenCalledWith("同事，加一下");
  });

  it("理由是选填：清空也能发（发空串，不拦）", () => {
    const onSend = vi.fn();
    render(<FriendRequestModal name="小明" defaultHello="我是老王" busy={false} onSend={onSend} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/验证消息/), { target: { value: "" } });
    fireEvent.click(screen.getByText("发送申请"));
    expect(onSend).toHaveBeenCalledWith("");
  });

  // 服务端超长会**截断**，端上先拦一道是为了当场知道写不下了，而不是发完才发现被剪掉半句。
  it("输入框按 MAX_FRIEND_HELLO 限长，并显示字数", () => {
    render(<FriendRequestModal name="小明" defaultHello="" busy={false} onSend={vi.fn()} onClose={vi.fn()} />);
    const box = screen.getByLabelText(/验证消息/) as HTMLTextAreaElement;
    expect(box.maxLength).toBe(MAX_FRIEND_HELLO);
    fireEvent.change(box, { target: { value: "你好" } });
    expect(screen.getByText(`2/${MAX_FRIEND_HELLO}`)).toBeTruthy();
  });

  it("busy 时按钮禁用（防重复发）", () => {
    render(<FriendRequestModal name="小明" defaultHello="" busy onSend={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByText("发送中…").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("FriendRequestsModal（新的朋友）", () => {
  const base = { labelOf: label, busyUser: null, onAccept: vi.fn(), onReject: vi.fn(), onClose: vi.fn() };

  it("待我确认的申请显示验证消息，同意/拒绝回传 uid", () => {
    const onAccept = vi.fn(); const onReject = vi.fn();
    render(<FriendRequestsModal {...base} onAccept={onAccept} onReject={onReject}
      incoming={[f({ user_id: "p1", hello: "我是隔壁老王" })]} outgoing={[]} />);
    expect(screen.getByText("我是隔壁老王")).toBeTruthy();
    fireEvent.click(screen.getByText("同意")); expect(onAccept).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByText("拒绝")); expect(onReject).toHaveBeenCalledWith("p1");
  });

  // 老数据/对方没写时给中性说明，不显空行也不编造内容。
  it("没有验证消息时显中性说明，且不露内部 ID", () => {
    const { container } = render(<FriendRequestsModal {...base} incoming={[f({ user_id: "4820571639" })]} outgoing={[]} />);
    expect(screen.getByText("没有留下验证消息")).toBeTruthy();
    expect(container.textContent).not.toContain("4820571639");
  });

  // 只显 incoming 的话，发起方点完「加好友」就再也看不到这件事的下文。
  it("我发出的申请单列一段，显「等待验证」且不给同意/拒绝按钮", () => {
    render(<FriendRequestsModal {...base} incoming={[]} outgoing={[f({ user_id: "o1", status: "requested", hello: "我是小李" })]} />);
    expect(screen.getByText("已发出（1）")).toBeTruthy();
    expect(screen.getByText("我是小李")).toBeTruthy();
    expect((screen.getByText("等待验证") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("同意")).toBeNull();
  });

  it("两段都空时显空态", () => {
    render(<FriendRequestsModal {...base} incoming={[]} outgoing={[]} />);
    expect(screen.getByText("没有待处理的好友申请")).toBeTruthy();
  });
});
