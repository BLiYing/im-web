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
import { screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChatMessage } from "./sdk/protocol";

// ---- mock ./sdk/imSdk（vi.mock 提升到顶部，工厂内自包含）----
vi.mock("./sdk/imSdk", async () => ({ IMClient: (await import("./testing/fakeIMClient")).FakeIMClient, registerAccount: vi.fn(async () => {}) }));

import { IMClient } from "./sdk/imSdk";

import type { Fake } from "./testing/fakeIMClient";
import {
  UID, PEER, CID, makeConv as conv, installJsdomShims, renderApp, loginAndWait, openChatWithPeer,
} from "./testing/appHarness";
const Fake = IMClient as unknown as Fake;

const incoming = (content: string, convSeq: number): ChatMessage => ({
  convId: CID, from: PEER, content, contentType: "text",
  convSeq, timestamp: Date.now(), status: "sent",
} as ChatMessage);

beforeEach(() => {
  localStorage.clear();
  Fake.conversations = [conv()];
  installJsdomShims();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("App 冒烟：登录 → 会话 → 聊天主链路", () => {
  it("无会话缓存时渲染登录页；登录后进入主界面并列出会话", async () => {
    renderApp();
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

// 会话列表的「大群」标记（SUPERGROUP_DESIGN §9）。
//
// 值得单测的理由：这是用户**第一个**察觉到大群与众不同的地方——列表里这个群没有在线绿点、
// 没有「正在输入」。标记漏了不会有任何报错，只会让人把"功能没了"当成 bug 报上来。
// 后端早就随 /conversations 下发 is_super，端上此前一直没接（iOS 连模型字段都没有）。
describe("会话列表：大群标记", () => {
  it("is_super 的群显示「大群」；普通群与单聊都不显示", async () => {
    Fake.conversations = [
      conv({ conv_id: "g_super", is_group: true, name: "两万人群", is_super: true } as never),
      conv({ conv_id: "g_plain", is_group: true, name: "小群", is_super: false } as never),
    ];
    renderApp();
    fireEvent.click(screen.getByText("免密登录"));
    await waitFor(() => expect(screen.getByText("两万人群")).toBeInTheDocument());

    // 标记只出现一次：跟在大群那一行，不是每个群都有。
    // 用 .conv-super-tag 选而不是按文字找——群名/头像首字母圈里也可能出现同样的字。
    const tags = document.querySelectorAll(".conv-super-tag");
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toBe("大群");
    // 标记与群名在同一行内（同一个 .convpeer 容器）——挂错容器会跑到预览行上去。
    expect(tags[0].closest(".convpeer")?.textContent).toContain("两万人群");
  });
});
