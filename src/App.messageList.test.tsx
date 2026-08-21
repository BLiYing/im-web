// @vitest-environment jsdom
/**
 * 消息列表渲染 / 交互特征测试（拆分安全网 · 为抽 <MessageList> 兜底）。
 * 通过真实 <App/> + mock IMClient 注入各类型消息，钉住每条渲染分支的结构与关键交互——
 * 之后把消息列表从 App.tsx 抽成组件时，这些断言必须保持绿（静默运行时回归的护栏）。
 *
 * FakeIMClient 与 App.smoke.test.tsx 共享 testing/fakeIMClient（vi.mock 工厂内 await import）；此处仅把
 * incoming 扩成可传任意 ChatMessage 字段的 recv()，用于造图/视频/文件/相册/引用/撤回/系统等。
 *
 * 覆盖：system / 撤回(己·对方) / 图片 / 视频 / 文件 / 相册宫格 / 引用条 / 转发溯源 / 图说 caption /
 *       已读双勾 / 已编辑 / 日期分隔 / 失败角标 / 多选态勾选。
 * 不覆盖（jsdom 无真实布局，留手动验证）：loadOlder 滚动锚定保位。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Conversation, ChatMessage } from "./sdk/protocol";

vi.mock("./sdk/imSdk", async () => ({ IMClient: (await import("./testing/fakeIMClient")).FakeIMClient, registerAccount: vi.fn(async () => {}) }));

import { IMClient } from "./sdk/imSdk";
import App from "./App";

import type { Fake } from "./testing/fakeIMClient";
const Fake = IMClient as unknown as Fake;

const UID = "1001", PEER = "2002";
const CID = `u_${UID}_u_${PEER}`;

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  conv_id: CID, peer: PEER, peer_nickname: "小明",
  last_message: { server_msg_id: "s1", from: PEER, content_type: "text", content: "在吗", conv_seq: 0, timestamp: Date.now() },
  latest_conv_seq: 0, unread: 0, read_seq: 0, peer_read_seq: 0,
  ...over,
});

let seqCounter = 0;
/** 造一条消息（默认对端文本）；传 over 覆盖任意字段。convSeq 缺省自增避免去重撞车。 */
const recv = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  convId: CID, from: PEER, content: "文本", contentType: "text",
  convSeq: ++seqCounter, timestamp: Date.now(), status: "sent",
  ...over,
} as ChatMessage);

/** 注入一条服务端消息并等它上屏。 */
async function push(m: ChatMessage) {
  await waitFor(() => { Fake.last!.handlers.onMessage!(m); });
}

const msgs = () => document.querySelector(".msgs") as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  seqCounter = 0;
  Fake.conversations = [conv()];
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  URL.createObjectURL ??= (() => "blob:fake") as typeof URL.createObjectURL;
  URL.revokeObjectURL ??= () => {};
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function enterChat(convOver: Partial<Conversation> = {}) {
  if (Object.keys(convOver).length) Fake.conversations = [conv(convOver)];
  render(<App />);
  fireEvent.click(screen.getByText("免密登录"));
  await waitFor(() => expect(screen.getAllByText("小明").length).toBeGreaterThan(0));
  fireEvent.click(document.querySelector(".convitem")!);
  await waitFor(() => expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument());
}

describe("消息列表：系统/撤回墓碑", () => {
  it("系统消息渲染为居中 .sys-line，无气泡", async () => {
    await enterChat();
    await push(recv({ contentType: "system", content: "小明 加入了群聊" }));
    const line = await screen.findByText("小明 加入了群聊");
    expect(line.closest(".sys-line")).toBeInTheDocument();
    expect(msgs().querySelector(".bubble")).toBeNull();
  });

  it("对方撤回：显示「对方撤回了一条消息」，无重新编辑钮", async () => {
    await enterChat();
    await push(recv({ contentType: "text", content: "手滑", recalledAt: Date.now() }));
    expect(await screen.findByText("对方撤回了一条消息")).toBeInTheDocument();
    expect(msgs().querySelector(".reedit-btn")).toBeNull();
  });

  it("本人撤回文本：显示「你撤回了一条消息」+「重新编辑」，点击回填输入框", async () => {
    await enterChat();
    await push(recv({ from: UID, contentType: "text", content: "打错了", recalledAt: Date.now() }));
    expect(await screen.findByText("你撤回了一条消息")).toBeInTheDocument();
    fireEvent.click(screen.getByText("重新编辑"));
    expect((screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement).value).toBe("打错了");
  });
});

describe("消息列表：媒体 / 文件 / 相册", () => {
  it("图片消息渲染媒体气泡 .bubble.media + .msg-image", async () => {
    await enterChat();
    await push(recv({ contentType: "image", content: "https://cdn/x/pic.png", thumb: "data:image/jpeg;base64,z", mediaW: 800, mediaH: 600 }));
    await waitFor(() => expect(msgs().querySelector(".bubble.media")).toBeInTheDocument());
    expect(msgs().querySelector("[class*=msg-image]")).toBeInTheDocument();
  });

  it("视频消息渲染媒体气泡（封面图或 video 帧）", async () => {
    await enterChat();
    await push(recv({ contentType: "video", content: "https://cdn/x/v.mp4", posterUrl: "https://cdn/x/p.jpg", duration: 12000, mediaW: 720, mediaH: 1280 }));
    await waitFor(() => expect(msgs().querySelector(".bubble.media")).toBeInTheDocument());
  });

  it("文件消息渲染 .msg-file，文件名取 fileName", async () => {
    await enterChat();
    await push(recv({ contentType: "file", content: "https://cdn/x/a.bin", fileName: "季度预算.xlsx", fileSize: 20480 }));
    const name = await screen.findByText("季度预算.xlsx");
    expect(name.closest(".msg-file")).toBeInTheDocument();
  });

  it("相册：同 groupId 多张图聚簇成 .album-grid（宫格 tile 数=张数），带 data-seq-end", async () => {
    await enterChat();
    const base = { contentType: "image", content: "https://cdn/x/a.png", thumb: "data:image/jpeg;base64,z", groupId: "alb1", mediaW: 400, mediaH: 400 } as Partial<ChatMessage>;
    await push(recv({ ...base, convSeq: 10 }));
    await push(recv({ ...base, convSeq: 11 }));
    await push(recv({ ...base, convSeq: 12 }));
    await waitFor(() => expect(msgs().querySelector(".album-grid")).toBeInTheDocument());
    expect(msgs().querySelectorAll(".album-tile").length).toBe(3);
    expect(msgs().querySelector(".msg-item[data-seq-end]")).toBeInTheDocument();
  });
});

describe("消息列表：引用 / 转发 / 图说", () => {
  it("引用回复渲染 .quote-bar，预览取 replySnapshot", async () => {
    await enterChat();
    await push(recv({ convSeq: 1, content: "被引用的原文" }));
    await push(recv({ convSeq: 2, content: "收到", replyToConvSeq: 1, replySnapshot: "被引用的原文" }));
    await waitFor(() => expect(msgs().querySelector(".quote-bar")).toBeInTheDocument());
    expect(msgs().querySelector(".quote-text")).toHaveTextContent("被引用的原文");
  });

  it("转发消息渲染「转发自 X」溯源", async () => {
    await enterChat();
    await push(recv({ content: "看这个", forwardFrom: "老王" }));
    expect(await screen.findByText(/转发自\s*老王/)).toBeInTheDocument();
  });

  it("图片带 caption：媒体卡下方渲染 .msg-caption", async () => {
    await enterChat();
    await push(recv({ contentType: "image", content: "https://cdn/x/p.png", thumb: "data:image/jpeg;base64,z", caption: "现场照片", mediaW: 400, mediaH: 400 }));
    const cap = await screen.findByText("现场照片");
    expect(cap.closest(".msg-caption")).toBeInTheDocument();
  });
});

describe("消息列表：状态标记", () => {
  it("本人消息被对端读过 → 双勾 .ck.read（✓✓）", async () => {
    await enterChat({ peer_read_seq: 5 });
    await push(recv({ from: UID, contentType: "text", content: "在的", convSeq: 1 }));
    await waitFor(() => expect(msgs().querySelector(".ck.read")).toBeInTheDocument());
  });

  it("已编辑消息标「已编辑」.edited-tag", async () => {
    await enterChat();
    await push(recv({ content: "改过的内容", editedAt: Date.now() }));
    await waitFor(() => expect(msgs().querySelector(".edited-tag")).toBeInTheDocument());
  });

  it("首条消息带日期分隔 .date-pill", async () => {
    await enterChat();
    await push(recv({ content: "第一句" }));
    await waitFor(() => expect(msgs().querySelector(".date-pill")).toBeInTheDocument());
  });

  it("本人失败消息显示失败角标 .fail-badge", async () => {
    await enterChat();
    await push(recv({ from: UID, contentType: "text", content: "发不出去", convSeq: 0, clientMsgId: "c-fail", status: "failed" }));
    await waitFor(() => expect(msgs().querySelector(".fail-badge")).toBeInTheDocument());
  });
});

describe("消息列表：多选态", () => {
  it("从 ⋯ 菜单进入多选：行变 .selecting + 勾选圈，点行切换选中", async () => {
    await enterChat();
    await push(recv({ content: "可选的消息", convSeq: 1 }));
    await screen.findByText("可选的消息");
    fireEvent.click(screen.getByTitle("更多"));
    fireEvent.click(await screen.findByText("选择消息"));
    await waitFor(() => expect(msgs().querySelector(".row.selecting")).toBeInTheDocument());
    const check = msgs().querySelector(".sel-check")!;
    expect(check).not.toHaveClass("on");
    fireEvent.click(msgs().querySelector(".row.selecting")!);
    await waitFor(() => expect(msgs().querySelector(".sel-check")).toHaveClass("on"));
  });
});
