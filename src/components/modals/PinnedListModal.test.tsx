// @vitest-environment jsdom
// 置顶面板（PINNED_PANEL_DESIGN §2 / 草图 ④）的渲染规则：定位图标左右（我发的在气泡左、别人的在右）、
// 只读（点图片不开查看器 = 定位）、群聊对方显头像昵称、无权限三处都不出现（菜单取消项 / 底栏 / 副标题）、Esc 关闭。
// App 级接线（横幅去轮转、长按取消只作用于那一条、批量摘除、一键取消）见 App.pinnedBanner.test.tsx。
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppServicesProvider, type AppServices } from "../../AppServicesContext";
import { ChatActionsProvider, type ChatActions } from "../../ChatActionsContext";
import { PinnedListModal, type PinnedListModalProps } from "./PinnedListModal";
import type { BubbleEnv } from "../MessageBubble";
import type { ChatMessage, PinnedMessage } from "../../sdk/protocol";

afterEach(cleanup);

const ME = "u1", OTHER = "u2", CID = "g1";
const msg = (convSeq: number, from: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  convId: CID, from, content: `消息${convSeq}`, contentType: "text", convSeq, timestamp: Date.UTC(2026, 9, 14, 10), status: "received", ...over,
} as ChatMessage);
const pinOf = (m: ChatMessage, pinnedAt = 1): PinnedMessage => ({
  convSeq: m.convSeq, serverMsgId: `s${m.convSeq}`, from: m.from, contentType: m.contentType, content: m.content,
  timestamp: m.timestamp, pinnedAt, message: m,
});

const env: BubbleEnv = {
  mediaGate: () => undefined, mediaSrc: (m) => m.content, senderLabel: (m) => (m.from === OTHER ? "张三" : m.from),
  localNameOf: (id) => id, senderRole: () => undefined, senderAvatar: () => undefined,
  renderMentionText: (_m, text) => text, renderMessageText: (m) => <span className="btext">{m.content}</span>,
  openPeerDetail: vi.fn(), handleScanRaw: vi.fn(async () => {}),
};

function mount(over: Partial<PinnedListModalProps> = {}) {
  const chatActions = {
    setMenu: vi.fn(), setViewer: vi.fn(), setRecordStack: vi.fn(), setToast: vi.fn(), locateInChat: vi.fn(),
    onGateTap: vi.fn(), onMediaBubbleTap: vi.fn(), openReadyFile: vi.fn(async () => {}), onPassiveMediaError: vi.fn(async () => {}),
    retryUpload: vi.fn(), resendMessage: vi.fn(), toggleUploadPause: vi.fn(), fetchLinkPreview: vi.fn(async () => ({})),
    onMediaLoad: vi.fn(), pendingFilesRef: { current: new Map() },
  } as unknown as ChatActions;
  const client = { pinMessage: vi.fn(), clearPinned: vi.fn(async () => 2) };
  const services = { clientRef: { current: client }, setToast: vi.fn() } as unknown as AppServices;
  const props: PinnedListModalProps = {
    pinned: [pinOf(msg(3, OTHER)), pinOf(msg(5, ME))], local: [], convId: CID, uid: ME, peer: "", isGroupChat: true,
    timeFormat: "24", canPin: true, env, onLocate: vi.fn(), onRefresh: vi.fn(), onClose: vi.fn(), ...over,
  };
  render(<AppServicesProvider value={services}><ChatActionsProvider value={chatActions}><PinnedListModal {...props} /></ChatActionsProvider></AppServicesProvider>);
  return { props, chatActions, client };
}
const item = (seq: number) => document.querySelector(`.pinned-item[data-pinned-seq="${seq}"]`)!;

describe("PinnedListModal", () => {
  it("定位图标紧挨气泡：别人的消息在气泡右（DOM 在 .row 之后），我发的在气泡左（DOM 在 .row 之前）", () => {
    mount();
    const order = (seq: number) => [...item(seq).querySelector(".pinned-line")!.children].map((el) => el.className.split(" ")[0]);
    expect(order(3)).toEqual(["row", "pinned-locate"]);
    expect(order(5)).toEqual(["pinned-locate", "row"]);
    expect(item(5)).toHaveClass("me");
  });

  it("群聊：别人的消息每条都显头像 + 昵称；我发的不显", () => {
    mount();
    expect(item(3).querySelector(".bubble-avatar")).toBeInTheDocument();
    expect(item(3).querySelector(".sender-name")!.textContent).toBe("张三");
    expect(item(5).querySelector(".them-wrap")).not.toBeInTheDocument();
  });

  it("只读：点图片不开查看器、不走门控，整条气泡点击 = 先关面板再定位", () => {
    const img = msg(8, OTHER, { contentType: "image", content: "/uploads/a.jpg", mediaW: 100, mediaH: 80 });
    const { props, chatActions } = mount({ pinned: [pinOf(img)] });
    fireEvent.click(item(8).querySelector("img.msg-image")!);
    expect(chatActions.onMediaBubbleTap).not.toHaveBeenCalled();
    expect(chatActions.setViewer).not.toHaveBeenCalled();
    expect(chatActions.onGateTap).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onLocate).toHaveBeenCalledWith(8);
  });

  it("只读：名片/文件/引用条点了也只是定位（不进资料页、不下载、不跳原消息）", () => {
    const card = msg(9, OTHER, { contentType: "contact", content: JSON.stringify({ u: "u7", n: "老王" }) });
    const file = msg(10, OTHER, { contentType: "file", content: "/uploads/a.pdf", fileName: "a.pdf", replyToConvSeq: 2, replySnapshot: "原文" });
    const { props, chatActions } = mount({ pinned: [pinOf(card), pinOf(file)] });
    fireEvent.click(item(9).querySelector(".contact-card")!);
    fireEvent.click(item(10).querySelector(".msg-file")!);
    fireEvent.click(item(10).querySelector(".quote-bar")!);
    expect(env.openPeerDetail).not.toHaveBeenCalled();
    expect(chatActions.openReadyFile).not.toHaveBeenCalled();
    expect(chatActions.locateInChat).not.toHaveBeenCalled();
    expect(props.onLocate).toHaveBeenNthCalledWith(1, 9);
    expect(props.onLocate).toHaveBeenNthCalledWith(3, 10);
  });

  it("只读：不画已读勾 / 发送状态", () => {
    mount({ pinned: [pinOf(msg(5, ME, { status: "sent" }))] });
    expect(item(5).querySelector(".ck")).not.toBeInTheDocument();
    expect(item(5).querySelector(".bmeta")!.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it("点定位图标 = 先关面板再定位", () => {
    const { props } = mount();
    fireEvent.click(item(5).querySelector(".pinned-locate")!);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onLocate).toHaveBeenCalledWith(5);
  });

  it("有权限：副标题「长按消息可取消置顶」+ 底栏「取消所有置顶」；长按菜单首项取消置顶（只发所长按那条）", () => {
    const { client } = mount();
    expect(screen.getByText("长按消息可取消置顶")).toBeInTheDocument();
    expect(screen.getByText("取消所有置顶")).toBeInTheDocument();
    fireEvent.contextMenu(item(3).querySelector(".bubble")!);
    fireEvent.click(screen.getByText("取消置顶"));
    expect(client.pinMessage).toHaveBeenCalledTimes(1);
    expect(client.pinMessage).toHaveBeenCalledWith(CID, 3, false);
  });

  it("无权限：菜单无取消项、无底栏、无副标题", () => {
    mount({ canPin: false });
    expect(screen.queryByText("长按消息可取消置顶")).not.toBeInTheDocument();
    expect(screen.queryByText("取消所有置顶")).not.toBeInTheDocument();
    fireEvent.contextMenu(item(3).querySelector(".bubble")!);
    const labels = [...document.querySelectorAll(".pinned-ctx-menu button")].map((b) => b.textContent);
    expect(labels).toEqual(["复制", "定位到聊天位置"]);
  });

  it("标题栏：左 ✕ 关闭、标题带条数；无底部「关闭」按钮；Esc 先收菜单再关面板", () => {
    const { props } = mount();
    expect(screen.getByText("置顶消息（2）")).toBeInTheDocument();
    expect(document.querySelector(".modal-close")).not.toBeInTheDocument();
    fireEvent.contextMenu(item(3).querySelector(".bubble")!);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".pinned-ctx-menu")).not.toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
