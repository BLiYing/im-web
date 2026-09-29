// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ForwardPicker } from "./ForwardPicker";
import { SYSTEM_UID, type Conversation } from "../../sdk/protocol";

afterEach(cleanup);

const conv = (id: string): Conversation => ({
  conv_id: id, peer: id, is_group: false, last_message: null,
  latest_conv_seq: 0, unread: 0, read_seq: 0, peer_read_seq: 0,
});
const convs = [conv("a"), conv("b"), conv("c")];
const base = {
  conversations: convs, convAvatarUrl: () => undefined, convDisplayLabel: (c: Conversation) => c.conv_id,
  onToggleMulti: vi.fn(), onSetMode: vi.fn(), onToggleTarget: vi.fn(), onForward: vi.fn(), onClose: vi.fn(),
};

describe("ForwardPicker 单选/多选与合并模式", () => {
  it("单选态：点会话行直接 onForward([该会话])，不走 onToggleTarget", () => {
    const onForward = vi.fn(); const onToggleTarget = vi.fn();
    render(<ForwardPicker {...base} count={1} multi={false} mode="each" targets={[]} onForward={onForward} onToggleTarget={onToggleTarget} />);
    fireEvent.click(screen.getByText("b", { selector: ".fwd-item-label" }));
    expect(onForward).toHaveBeenCalledWith([expect.objectContaining({ conv_id: "b" })]);
    expect(onToggleTarget).not.toHaveBeenCalled();
  });

  it("多选态：点会话行走 onToggleTarget；发送按钮按 targets 过滤后 onForward", () => {
    const onForward = vi.fn(); const onToggleTarget = vi.fn();
    render(<ForwardPicker {...base} count={1} multi={true} mode="each" targets={["a", "c"]} onForward={onForward} onToggleTarget={onToggleTarget} />);
    fireEvent.click(screen.getByText("b", { selector: ".fwd-item-label" }));
    expect(onToggleTarget).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getByText(/发送/));
    expect(onForward).toHaveBeenCalledWith([expect.objectContaining({ conv_id: "a" }), expect.objectContaining({ conv_id: "c" })]);
  });

  it("多选态 targets 为空：发送按钮禁用", () => {
    render(<ForwardPicker {...base} count={1} multi={true} mode="each" targets={[]} />);
    expect((screen.getByText(/发送/) as HTMLButtonElement).disabled).toBe(true);
  });

  it("count>1 才显逐条/合并模式切换，点击回传 onSetMode", () => {
    const onSetMode = vi.fn();
    const { rerender } = render(<ForwardPicker {...base} count={1} multi={false} mode="each" targets={[]} onSetMode={onSetMode} />);
    expect(screen.queryByText("合并转发")).toBeNull();
    rerender(<ForwardPicker {...base} count={3} multi={false} mode="each" targets={[]} onSetMode={onSetMode} />);
    fireEvent.click(screen.getByText("合并转发"));
    expect(onSetMode).toHaveBeenCalledWith("merged");
  });

  it("搜索按显示名收窄可见行；无命中显「无匹配会话」，清空即恢复", () => {
    render(<ForwardPicker {...base} count={1} multi={false} mode="each" targets={[]} />);
    const box = screen.getByLabelText("搜索会话");
    fireEvent.change(box, { target: { value: "b" } });
    expect(screen.queryByText("a", { selector: ".fwd-item-label" })).toBeNull();
    expect(screen.getByText("b", { selector: ".fwd-item-label" })).toBeTruthy();
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText("无匹配会话")).toBeTruthy();
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getByText("a", { selector: ".fwd-item-label" })).toBeTruthy();
  });

  // 先勾选、再输入搜索词把它过滤掉——发送时**不能**少发它。
  // 按可见行取选中项是这里最容易写错的一步，静默少发一个人还不报错。
  it("多选态：已选中的会话被搜索过滤掉后，发送仍把它算进去", () => {
    const onForward = vi.fn();
    render(<ForwardPicker {...base} count={1} multi={true} mode="each" targets={["a", "c"]} onForward={onForward} />);
    fireEvent.change(screen.getByLabelText("搜索会话"), { target: { value: "c" } });
    expect(screen.queryByText("a", { selector: ".fwd-item-label" })).toBeNull(); // a 已不可见
    fireEvent.click(screen.getByText(/发送/));
    expect(onForward).toHaveBeenCalledWith([expect.objectContaining({ conv_id: "a" }), expect.objectContaining({ conv_id: "c" })]);
  });

  // 系统通知是只读会话（服务端拒 send_msg to=system），列出来点了必报错。
  // 三个入口（转发消息 / 收藏转发 / 推荐名片）都汇到本组件，挡在这一层。
  it("系统通知会话不出现在列表里，搜索也搜不出来", () => {
    const sys: Conversation = { ...conv(SYSTEM_UID), peer: SYSTEM_UID };
    render(<ForwardPicker {...base} conversations={[...convs, sys]} count={1} multi={false} mode="each" targets={[]} />);
    expect(screen.queryByText(SYSTEM_UID, { selector: ".fwd-item-label" })).toBeNull();
    fireEvent.change(screen.getByLabelText("搜索会话"), { target: { value: SYSTEM_UID } });
    expect(screen.getByText("无匹配会话")).toBeTruthy();
  });

  it("多选态：系统通知即使混进 targets 也不会被发送", () => {
    const onForward = vi.fn();
    const sys: Conversation = { ...conv(SYSTEM_UID), peer: SYSTEM_UID };
    render(<ForwardPicker {...base} conversations={[...convs, sys]} count={1} multi={true} mode="each"
      targets={["a", SYSTEM_UID]} onForward={onForward} />);
    fireEvent.click(screen.getByText(/发送/));
    expect(onForward).toHaveBeenCalledWith([expect.objectContaining({ conv_id: "a" })]);
  });

  it("「多选」按钮回传 onToggleMulti", () => {
    const onToggleMulti = vi.fn();
    render(<ForwardPicker {...base} count={1} multi={false} mode="each" targets={[]} onToggleMulti={onToggleMulti} />);
    fireEvent.click(screen.getByText("多选"));
    expect(onToggleMulti).toHaveBeenCalled();
  });
});

// 「添加例外」（NOTIFICATIONS_P1_DESIGN §2）复用本组件的可选入参：filter/title/hideMultiToggle/footer/emptyText。
describe("ForwardPicker 可选入参（添加例外场景收窄用）", () => {
  it("filter 在系统通知过滤之后再收窄一次；不传则不额外过滤", () => {
    render(<ForwardPicker {...base} count={1} multi={false} mode="each" targets={[]} filter={(c) => c.conv_id !== "b"} />);
    expect(screen.queryByText("b", { selector: ".fwd-item-label" })).toBeNull();
    expect(screen.getByText("a", { selector: ".fwd-item-label" })).toBeTruthy();
  });

  it("title 覆盖默认的「转发(N)」标题", () => {
    render(<ForwardPicker {...base} count={1} multi={false} mode="each" targets={[]} title="添加例外" />);
    expect(screen.getByText("添加例外")).toBeTruthy();
    expect(screen.queryByText(/^转发/)).toBeNull();
  });

  it("hideMultiToggle 隐藏右上角「多选」按钮", () => {
    render(<ForwardPicker {...base} count={1} multi={false} mode="each" targets={[]} hideMultiToggle />);
    expect(screen.queryByText("多选")).toBeNull();
  });

  it("footer 在列表下方显示说明文案，不传则不渲染", () => {
    const { rerender } = render(<ForwardPicker {...base} count={1} multi={false} mode="each" targets={[]} />);
    expect(screen.queryByText("只列未免打扰的会话")).toBeNull();
    rerender(<ForwardPicker {...base} count={1} multi={false} mode="each" targets={[]} footer="只列未免打扰的会话" />);
    expect(screen.getByText("只列未免打扰的会话")).toBeTruthy();
  });

  it("emptyText 覆盖「列表本身为空」（非搜索）时的空态文案", () => {
    render(<ForwardPicker {...base} conversations={[]} count={1} multi={false} mode="each" targets={[]} emptyText="没有可添加的会话" />);
    expect(screen.getByText("没有可添加的会话")).toBeTruthy();
    expect(screen.queryByText("暂无会话")).toBeNull();
  });
});
