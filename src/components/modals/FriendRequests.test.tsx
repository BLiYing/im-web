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
    const box = screen.getByPlaceholderText(/让对方知道你是谁/) as HTMLTextAreaElement;
    expect(box.value).toBe("我是老王");
    fireEvent.change(box, { target: { value: "  同事，加一下  " } });
    fireEvent.click(screen.getByText("发送"));
    expect(onSend).toHaveBeenCalledWith("同事，加一下");
  });

  it("理由是选填：清空也能发（发空串，不拦）", () => {
    const onSend = vi.fn();
    render(<FriendRequestModal name="小明" defaultHello="我是老王" busy={false} onSend={onSend} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/让对方知道你是谁/), { target: { value: "" } });
    fireEvent.click(screen.getByText("发送"));
    expect(onSend).toHaveBeenCalledWith("");
  });

  // 服务端超长会**截断**，端上先拦一道是为了当场知道写不下了，而不是发完才发现被剪掉半句。
  it("输入框按 MAX_FRIEND_HELLO 限长，并显示字数", () => {
    render(<FriendRequestModal name="小明" defaultHello="" busy={false} onSend={vi.fn()} onClose={vi.fn()} />);
    const box = screen.getByPlaceholderText(/让对方知道你是谁/) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "你好" } });
    expect(screen.getByText(`2/${MAX_FRIEND_HELLO}`)).toBeTruthy();
    // 按码点：50 个 emoji（各 2 个 UTF-16 单元）全收；粘贴 60 个截成 50 个且不劈开代理对
    fireEvent.change(box, { target: { value: "😀".repeat(60) } });
    expect(box.value).toBe("😀".repeat(MAX_FRIEND_HELLO));
    expect(screen.getByText(`${MAX_FRIEND_HELLO}/${MAX_FRIEND_HELLO}`)).toBeTruthy();
  });

  it("提示行含对方名并渲染成两行；无重复 label 行", () => {
    render(<FriendRequestModal name="小明" defaultHello="" busy={false} onSend={vi.fn()} onClose={vi.fn()} />);
    const tip = screen.getByText(/发送给 小明/);
    expect(tip.textContent).toBe("发送给 小明\n验证消息会展示给对方（选填）");
    expect(document.querySelector(".friendreq-label")).toBeNull();
  });

  // autoFocus 会把光标停在预填文案的**最前面**：想在「我是老王」后面补一句的人得先按 End。
  it("打开即聚焦，且光标落在预填文案末尾", () => {
    render(<FriendRequestModal name="小明" defaultHello="我是老王" busy={false} onSend={vi.fn()} onClose={vi.fn()} />);
    const box = screen.getByPlaceholderText(/让对方知道你是谁/) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe("我是老王".length);
    expect(box.selectionEnd).toBe("我是老王".length);
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
