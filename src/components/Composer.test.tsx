// @vitest-environment jsdom
// 聊天底部区（Composer）的渲染 + 接线回归（阶段 3 抽出）。发消息主链路由 App.smoke 兜底；这里钉住其余分支：
// 编辑条 / 引用条 / 多选栏 / 粘贴预览条 / 跳底钮 / @面板 / 拉黑提示 / 发送键策略。任一接线错即红。
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { Image as ImageIcon } from "lucide-react";
afterEach(cleanup);
import { ChatActionsProvider, type ChatActions } from "../ChatActionsContext";
import { Composer, type ComposerProps } from "./Composer";
import type { ChatMessage } from "../sdk/protocol";

function actions(over: Partial<ChatActions> = {}): ChatActions {
  return {
    setInput: vi.fn(), locateInChat: vi.fn(), jumpToBottom: vi.fn(), unblock: vi.fn(async () => {}),
    setEditingMsg: vi.fn(), setReplyTo: vi.fn(), exitSelectMode: vi.fn(), forwardSelected: vi.fn(), deleteSelected: vi.fn(),
    removePastedImage: vi.fn(), cancelAttachClose: vi.fn(), scheduleAttachClose: vi.fn(), setAttachPanel: vi.fn(),
    pickFile: vi.fn(), openFavoritesPick: vi.fn(), onFilePicked: vi.fn(), setMentionFilter: vi.fn(), pickMention: vi.fn(),
    setMentionActive: vi.fn(), onInputChange: vi.fn(), onComposerPaste: vi.fn(), send: vi.fn(),
    attachAnchorRef: createRef<HTMLDivElement>(), fileInputRef: createRef<HTMLInputElement>(),
    mentionPanelRef: createRef<HTMLDivElement>(), mentionActiveRef: createRef<HTMLButtonElement>(), composerRef: createRef<HTMLTextAreaElement>(),
    ...over,
  } as unknown as ChatActions;
}
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  convId: "c1", from: "u2", content: "原消息内容", contentType: "text", convSeq: 7, timestamp: 1, status: "sent", ...over,
} as ChatMessage);
function base(over: Partial<ComposerProps> = {}): ComposerProps {
  return {
    convId: "c1", peer: "u2", uid: "u1", isGroupChat: false, peerLabel: "小明", peerBlocked: false,
    input: "", sendKey: "enter", composerMuteReason: null, showJump: false, jumpCount: 0,
    editingMsg: null, replyTo: null, selectMode: false, selected: new Set(), pastedImages: [],
    attachPanel: false, attachItems: [{ id: "image", label: "图片或视频", accept: "image/*", icon: ImageIcon }],
    mentionQuery: null, mentionFilter: "", mentionRows: [], mentionActive: 0,
    mediaGate: () => undefined, senderLabel: (m) => m.from, onMentionNavKey: () => false,
    ...over,
  };
}
const mount = (p: ComposerProps, a: ChatActions) => render(<ChatActionsProvider value={a}><Composer {...p} /></ChatActionsProvider>);

describe("Composer", () => {
  it("默认：输入框可用、发送钮在；Enter → send()，Shift+Enter 不发", () => {
    const a = actions();
    const { getByPlaceholderText, getByText } = mount(base(), a);
    const ta = getByPlaceholderText(/输入消息，回车发送/);
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(a.send).not.toHaveBeenCalled();
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(a.send).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText("发送"));
    expect(a.send).toHaveBeenCalledTimes(2);
  });
  it("cmd 发送键策略：Enter 不发、Cmd+Enter 发；禁言原因 → 输入框禁用并显原因", () => {
    const a = actions();
    const { getByPlaceholderText, rerender } = mount(base({ sendKey: "cmd" }), a);
    const ta = getByPlaceholderText(/Cmd\+Enter 发送/);
    fireEvent.keyDown(ta, { key: "Enter" }); expect(a.send).not.toHaveBeenCalled();
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true }); expect(a.send).toHaveBeenCalledTimes(1);
    rerender(<ChatActionsProvider value={a}><Composer {...base({ composerMuteReason: "你已被禁言" })} /></ChatActionsProvider>);
    expect((getByPlaceholderText("你已被禁言") as HTMLTextAreaElement).disabled).toBe(true);
  });
  it("引用条：显「回复 小明」+ 预览；✕ → setReplyTo(null)；点预览 → locateInChat", () => {
    const a = actions();
    const { getByText, getByTitle } = mount(base({ replyTo: msg() }), a);
    expect(getByText(/回复 小明/)).toBeTruthy(); expect(getByText("原消息内容")).toBeTruthy();
    fireEvent.click(getByTitle("跳到原消息")); expect(a.locateInChat).toHaveBeenCalledWith("c1", 7);
    fireEvent.click(getByTitle("取消引用")); expect(a.setReplyTo).toHaveBeenCalledWith(null);
  });
  it("编辑条：显「编辑消息」；✕ → setEditingMsg(null) + setInput('')", () => {
    const a = actions();
    const { getByText, getByTitle } = mount(base({ editingMsg: msg({ from: "u1" }) }), a);
    expect(getByText("编辑消息")).toBeTruthy();
    fireEvent.click(getByTitle("取消编辑"));
    expect(a.setEditingMsg).toHaveBeenCalledWith(null); expect(a.setInput).toHaveBeenCalledWith("");
  });
  it("多选态：替换为工具栏（已选 N）；转发/删除接线；0 选中时禁用", () => {
    const a = actions();
    const { getByText, queryByPlaceholderText, rerender } = mount(base({ selectMode: true, selected: new Set([1, 2]) }), a);
    expect(queryByPlaceholderText(/输入消息/)).toBeNull();
    expect(getByText("已选 2")).toBeTruthy();
    fireEvent.click(getByText("转发")); expect(a.forwardSelected).toHaveBeenCalled();
    fireEvent.click(getByText("删除")); expect(a.deleteSelected).toHaveBeenCalled();
    fireEvent.click(getByText("取消")); expect(a.exitSelectMode).toHaveBeenCalled();
    rerender(<ChatActionsProvider value={a}><Composer {...base({ selectMode: true, selected: new Set() })} /></ChatActionsProvider>);
    expect((getByText("转发") as HTMLButtonElement).disabled).toBe(true);
  });
  it("粘贴预览条：图片缩略 + 文件名；✕ → removePastedImage(i)", () => {
    const a = actions();
    const f = new File(["x"], "报表.xlsx");
    const { getByText, getAllByTitle } = mount(base({ pastedImages: [
      { file: new File(["x"], "a.png"), url: "blob:a", kind: "image" }, { file: f, url: "blob:b", kind: "file" }] }), a);
    expect(getByText("报表.xlsx")).toBeTruthy();
    fireEvent.click(getAllByTitle("移除")[1]); expect(a.removePastedImage).toHaveBeenCalledWith(1);
  });
  it("跳底钮（showJump）显示未读数 → jumpToBottom；拉黑提示 → 解除拉黑 → unblock(peer)", () => {
    const a = actions();
    const { getByTitle, getByText } = mount(base({ showJump: true, jumpCount: 3, peerBlocked: true }), a);
    expect(getByTitle("跳到最新消息").textContent).toContain("3");
    fireEvent.click(getByTitle("跳到最新消息")); expect(a.jumpToBottom).toHaveBeenCalled();
    fireEvent.click(getByText("解除拉黑")); expect(a.unblock).toHaveBeenCalledWith("u2");
  });
  it("@面板：渲染候选行 + 徽标；mousedown → pickMention(label, uid)；无匹配时显空态", () => {
    const a = actions();
    const rows = [{ label: "阿伟", userId: "u9", role: "owner" }, { label: "所有人", userId: null }];
    const { getByText, container, rerender } = mount(base({ isGroupChat: true, mentionQuery: "", mentionRows: rows }), a);
    expect(getByText("群主")).toBeTruthy();
    expect(container.querySelector(".mention-row .mention-name")?.textContent).toBe("阿伟"); // 头像首字也是「阿」开头，按行定位
    fireEvent.mouseDown(container.querySelector(".mention-row")!); expect(a.pickMention).toHaveBeenCalledWith("阿伟", "u9");
    rerender(<ChatActionsProvider value={a}><Composer {...base({ isGroupChat: true, mentionQuery: "zz", mentionRows: [] })} /></ChatActionsProvider>);
    expect(getByText("无匹配成员")).toBeTruthy();
  });
  it("附件弹层（attachPanel）：数据驱动项 → pickFile(id, accept)；收藏 → openFavoritesPick", () => {
    const a = actions();
    const { getByText } = mount(base({ attachPanel: true }), a);
    fireEvent.click(getByText("图片或视频")); expect(a.pickFile).toHaveBeenCalledWith("image", "image/*");
    fireEvent.click(getByText("收藏")); expect(a.openFavoritesPick).toHaveBeenCalled();
  });
});
