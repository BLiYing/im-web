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
    setEditingMsg: vi.fn(), setReplyTo: vi.fn(), exitSelectMode: vi.fn(), forwardSelected: vi.fn(), favoriteSelected: vi.fn(), reportSelected: vi.fn(), deleteSelected: vi.fn(), deleteSelectedForEveryone: vi.fn(),
    removePastedImage: vi.fn(), cancelAttachClose: vi.fn(), scheduleAttachClose: vi.fn(), setAttachPanel: vi.fn(),
    pickFile: vi.fn(), openFavoritesPick: vi.fn(), onFilePicked: vi.fn(), setMentionFilter: vi.fn(), pickMention: vi.fn(),
    setMentionActive: vi.fn(), onInputChange: vi.fn(), onComposerPaste: vi.fn(), addPastedFiles: vi.fn(), send: vi.fn(),
    sendVoice: vi.fn(() => Promise.resolve()),
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
    editingMsg: null, replyTo: null, selectMode: false, selected: new Set(),
    reportableSender: null, reportHasMine: false, pastedImages: [],
    attachPanel: false, attachItems: [{ id: "image", label: "图片或视频", accept: "image/*", icon: ImageIcon }],
    mentionQuery: null, mentionFilter: "", mentionRows: [], mentionActive: 0,
    mediaGate: () => undefined, senderLabel: (m) => m.from, onMentionNavKey: () => false,
    ...over,
  };
}
const mount = (p: ComposerProps, a: ChatActions) => render(<ChatActionsProvider value={a}><Composer {...p} /></ChatActionsProvider>);

describe("Composer · 拖文件进聊天列（useFileDrop 接线）", () => {
  const png = new File(["x"], "a.png", { type: "image/png" });
  // 接收区是 `.chat`（在 App 里），这里包一层同名容器模拟真实结构。
  const mountInChat = (p: ComposerProps, a: ChatActions) =>
    render(<div className="chat"><ChatActionsProvider value={a}><Composer {...p} /></ChatActionsProvider></div>);
  /** jsdom 没有 DataTransfer 构造器：造一个带 dataTransfer 的可取消 drop 事件。 */
  const drop = (target: Element) => {
    const e = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], files: [png], dropEffect: "" } });
    target.dispatchEvent(e);
    return e;
  };

  it("有会话、可发言 → 文件以 drop 来源进预览条（与粘贴同一条路，不直接发）", () => {
    const a = actions();
    const { container } = mountInChat(base(), a);
    drop(container.querySelector(".chat")!);
    expect(a.addPastedFiles).toHaveBeenCalledWith([png], "drop");
    expect(a.send).not.toHaveBeenCalled();
  });

  it("被禁言 / 多选态 / 没打开会话 → 不收，但仍拦住默认行为（否则浏览器会打开这个文件）", () => {
    const cases: Partial<ComposerProps>[] = [{ composerMuteReason: "你已被禁言" }, { selectMode: true }, { convId: "" }];
    for (const over of cases) {
      const a = actions();
      const { container, unmount } = mountInChat(base(over), a);
      const e = drop(container.querySelector(".chat")!);
      expect(e.defaultPrevented).toBe(true);
      expect(a.addPastedFiles).not.toHaveBeenCalled();
      unmount();
    }
  });
});

describe("Composer", () => {
  it("默认：输入框可用、发送钮在（有输入时）；Enter → send()，Shift+Enter 不发", () => {
    const a = actions();
    // Web P1：空框显 mic、有输入才显发送——测试传 input 非空以走发送分支。
    const { getByPlaceholderText, getByText } = mount(base({ input: "hello" }), a);
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
  it("多选态：替换为工具栏（已选 N）；转发/收藏/删除接线（圆形玻璃图标钮，用 aria-label 命中）；0 选中时禁用", () => {
    const a = actions();
    const { getByText, getByLabelText, queryByPlaceholderText, rerender } = mount(base({ selectMode: true, selected: new Set([1, 2]) }), a);
    expect(queryByPlaceholderText(/输入消息/)).toBeNull();
    expect(getByText("已选 2")).toBeTruthy();
    fireEvent.click(getByLabelText("转发")); expect(a.forwardSelected).toHaveBeenCalled();
    fireEvent.click(getByLabelText("收藏")); expect(a.favoriteSelected).toHaveBeenCalled();
    // 删除是两步：点删除钮弹「仅为我删除」确认气泡，点它才真正删。
    fireEvent.click(getByLabelText("删除")); expect(a.deleteSelected).not.toHaveBeenCalled();
    fireEvent.click(getByText("仅为我删除")); expect(a.deleteSelected).toHaveBeenCalled();
    fireEvent.click(getByText("取消")); expect(a.exitSelectMode).toHaveBeenCalled();
    rerender(<ChatActionsProvider value={a}><Composer {...base({ selectMode: true, selected: new Set() })} /></ChatActionsProvider>);
    expect((getByLabelText("转发") as HTMLButtonElement).disabled).toBe(true);
  });
  it("多选删除气泡：canDeleteEveryone 才露出「为所有人删除」，点它走 deleteSelectedForEveryone 而不是仅为我那条", () => {
    const a = actions();
    const { getByText, queryByText, getByLabelText, rerender } = mount(base({ selectMode: true, selected: new Set([1, 2]) }), a);
    fireEvent.click(getByLabelText("删除"));
    expect(getByText("仅为我删除")).toBeTruthy();
    expect(queryByText("为所有人删除")).toBeNull(); // 混选了别人的消息：只有一档
    rerender(<ChatActionsProvider value={a}><Composer {...base({ selectMode: true, selected: new Set([1, 2]), canDeleteEveryone: true })} /></ChatActionsProvider>);
    fireEvent.click(getByText("为所有人删除"));
    expect(a.deleteSelectedForEveryone).toHaveBeenCalled();
    expect(a.deleteSelected).not.toHaveBeenCalled();
    expect(queryByText("为所有人删除")).toBeNull(); // 点完气泡收起
  });
  // 举报钮（2026-09-06）：仅当所选**全是同一个对方**发的才可点，否则**置灰不隐藏**——
  // 隐藏会让栏内按钮数随勾选变化、每勾一下按钮就左右跳。
  it("多选态举报钮：同一发送者可点；含自己/跨发送者置灰且给出原因，但按钮始终在场", () => {
    const a = actions();
    const sel = new Set([1, 2]);
    const { getByLabelText, rerender } = mount(base({ selectMode: true, selected: sel, reportableSender: "u2" }), a);
    const btn = () => getByLabelText("举报") as HTMLButtonElement;
    expect(btn().disabled).toBe(false);
    fireEvent.click(btn()); expect(a.reportSelected).toHaveBeenCalled();

    const remount = (over: Partial<ComposerProps>) =>
      rerender(<ChatActionsProvider value={a}><Composer {...base({ selectMode: true, selected: sel, ...over })} /></ChatActionsProvider>);

    // 含我自己发的 → 灰 + 说清原因（disabled 按钮不触发 onClick，故原因走 title）。
    remount({ reportableSender: null, reportHasMine: true });
    expect(btn().disabled).toBe(true);
    expect(btn().title).toBe("不能举报自己的消息");

    // 跨发送者 → 灰 + 另一条原因。
    remount({ reportableSender: null, reportHasMine: false });
    expect(btn().disabled).toBe(true);
    expect(btn().title).toBe("一次只能举报同一个人的消息");

    // 0 选中：全栏皆灰，此时不单独解释举报（其余三钮同样是灰的）。
    rerender(<ChatActionsProvider value={a}><Composer {...base({ selectMode: true, selected: new Set(), reportableSender: null })} /></ChatActionsProvider>);
    expect(btn().disabled).toBe(true);
    expect(btn().title).toBe("举报");
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
