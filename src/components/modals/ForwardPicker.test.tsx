// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ForwardPicker } from "./ForwardPicker";
import type { Conversation } from "../../sdk/protocol";

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

  it("「多选」按钮回传 onToggleMulti", () => {
    const onToggleMulti = vi.fn();
    render(<ForwardPicker {...base} count={1} multi={false} mode="each" targets={[]} onToggleMulti={onToggleMulti} />);
    fireEvent.click(screen.getByText("多选"));
    expect(onToggleMulti).toHaveBeenCalled();
  });
});
