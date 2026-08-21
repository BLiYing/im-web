// @vitest-environment jsdom
/**
 * App 级交互冒烟测试（拆分安全网核心）：mock 掉 ./sdk/imSdk，渲染真实 <App/> 走通
 * 登录 → 会话列表 → 进会话 → 发消息/收消息 → ACK 的主链路。
 * 后续对 App.tsx 的任何拆分（JSX 面板抽组件 / 逻辑抽 hook）都必须保持本套用例绿。
 *
 * 约定：FakeIMClient 用 Proxy 兜底未显式实现的方法（返回 async undefined），
 * 显式实现的仅限启动/聊天主链路所需；测试通过 (IMClient as any).last 拿到实例驱动服务端事件。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Conversation, ChatMessage } from "./sdk/protocol";

// ---- mock ./sdk/imSdk（vi.mock 提升到顶部，工厂内自包含）----
vi.mock("./sdk/imSdk", async () => ({ IMClient: (await import("./testing/fakeIMClient")).FakeIMClient, registerAccount: vi.fn(async () => {}) }));

import { IMClient } from "./sdk/imSdk";
import App from "./App";

import type { Fake } from "./testing/fakeIMClient";
const Fake = IMClient as unknown as Fake;

const UID = "1001", PEER = "2002";
const CID = `u_${UID}_u_${PEER}`; // convIdFor(1001,2002)

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  conv_id: CID, peer: PEER, peer_nickname: "小明",
  last_message: { server_msg_id: "s1", from: PEER, content_type: "text", content: "在吗", conv_seq: 0, timestamp: Date.now() },
  latest_conv_seq: 0, unread: 0, read_seq: 0, peer_read_seq: 0,
  ...over,
});

const incoming = (content: string, convSeq: number): ChatMessage => ({
  convId: CID, from: PEER, content, contentType: "text",
  convSeq, timestamp: Date.now(), status: "sent",
} as ChatMessage);

beforeEach(() => {
  localStorage.clear();
  Fake.conversations = [conv()];
  // jsdom 缺失的浏览器 API（App 滚动定位/objectURL 用到）
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  URL.createObjectURL ??= (() => "blob:fake") as typeof URL.createObjectURL;
  URL.revokeObjectURL ??= () => {};
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** 免密登录进入主界面，等会话列表出现（「小明」同时出现在头像回退字与昵称里，用 AllByText）。 */
async function loginAndWait() {
  render(<App />);
  fireEvent.click(screen.getByText("免密登录"));
  await waitFor(() => expect(screen.getAllByText("小明").length).toBeGreaterThan(0));
}

/** 进入与小明的单聊（点会话行），等 composer 出现。 */
async function openChatWithPeer() {
  fireEvent.click(document.querySelector(".convitem")!);
  await waitFor(() => expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument());
}

describe("App 冒烟：登录 → 会话 → 聊天主链路", () => {
  it("无会话缓存时渲染登录页；登录后进入主界面并列出会话", async () => {
    render(<App />);
    expect(screen.getByText("IM Web 登录")).toBeInTheDocument();
    fireEvent.click(screen.getByText("免密登录"));
    await waitFor(() => expect(screen.getAllByText("小明").length).toBeGreaterThan(0));
    // 登录凭据落 localStorage（刷新静默重登的骨架）
    expect(JSON.parse(localStorage.getItem("im.session")!)).toMatchObject({ uid: UID });
  });

  it("点会话行进入聊天：标题=对端昵称，composer 可输入", async () => {
    await loginAndWait();
    await openChatWithPeer();
    expect(document.querySelector(".chat-title")).toHaveTextContent("小明");
    expect(Fake.last!.calls.watchUsers?.[0]?.[0]).toEqual([PEER]); // 进会话订阅对端在线态
  });

  it("发消息：回车触发 sendText，乐观气泡上屏；ACK 后仍在", async () => {
    await loginAndWait();
    await openChatWithPeer();
    const box = screen.getByPlaceholderText(/输入消息/);
    fireEvent.change(box, { target: { value: "你好小明" } });
    fireEvent.keyDown(box, { key: "Enter" });

    // SDK 被调 + 乐观回显
    expect(Fake.last!.calls.sendText?.[0]).toEqual(["你好小明", PEER, CID]);
    expect(await screen.findByText("你好小明")).toBeInTheDocument();
    expect((box as HTMLTextAreaElement).value).toBe(""); // 发完清空输入框

    // 服务端 ACK（conv_seq=1）：气泡保留，不重复
    await waitFor(() => { Fake.last!.handlers.onAck!("cmid-1", true, 1, Date.now()); });
    expect(screen.getAllByText("你好小明")).toHaveLength(1);
  });

  it("收消息：onMessage 投递后气泡上屏；同 conv_seq 重投不重复", async () => {
    await loginAndWait();
    await openChatWithPeer();
    await waitFor(() => { Fake.last!.handlers.onMessage!(incoming("周末爬山去？", 1)); });
    expect(await screen.findByText("周末爬山去？")).toBeInTheDocument();

    // 同 seq 重复投递（sync 重放）：去重，不出现第二条
    await waitFor(() => { Fake.last!.handlers.onMessage!(incoming("周末爬山去？", 1)); });
    expect(screen.getAllByText("周末爬山去？")).toHaveLength(1);
  });

  it("对话中连续收发保持顺序（发→收→发）", async () => {
    await loginAndWait();
    await openChatWithPeer();
    const box = screen.getByPlaceholderText(/输入消息/);

    fireEvent.change(box, { target: { value: "第一条" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => { Fake.last!.handlers.onAck!("cmid-1", true, 1, Date.now()); });
    await waitFor(() => { Fake.last!.handlers.onMessage!(incoming("第二条", 2)); });
    fireEvent.change(box, { target: { value: "第三条" } });
    fireEvent.keyDown(box, { key: "Enter" });

    const msgs = document.querySelector(".msgs")!;
    const texts = [...within(msgs as HTMLElement).queryAllByText(/第[一二三]条/)].map((n) => n.textContent);
    expect(texts).toEqual(["第一条", "第二条", "第三条"]);
  });
});
