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
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Conversation, ChatMessage } from "./sdk/protocol";

vi.mock("./sdk/imSdk", async () => ({ IMClient: (await import("./testing/fakeIMClient")).FakeIMClient, registerAccount: vi.fn(async () => {}) }));

vi.mock("./rtc/rtcCall", async (orig) => ({ ...(await orig<typeof import("./rtc/rtcCall")>()), placeSingleCall: vi.fn(() => true) }));

import { IMClient } from "./sdk/imSdk";
import { placeSingleCall } from "./rtc/rtcCall";

import type { Fake } from "./testing/fakeIMClient";
import {
  UID, PEER, CID, makeConv as conv, installJsdomShims, enterChat as enterChatDefault,
} from "./testing/appHarness";
const Fake = IMClient as unknown as Fake;

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
  installJsdomShims();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** 登录进单聊；convOver 非空时先改掉会话行字段（如 peer_read_seq，用于已读双勾用例）。 */
async function enterChat(convOver: Partial<Conversation> = {}) {
  if (Object.keys(convOver).length) Fake.conversations = [conv(convOver)];
  await enterChatDefault();
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

  it("转发消息按普通消息显示：不再渲染「转发自 X」溯源（隐私保护）", async () => {
    await enterChat();
    await push(recv({ content: "看这个", forwardFrom: "老王" }));
    // 正文照常显示，但不出现"转发自"溯源行（forwardFrom 仍在模型里、供再转发链路，仅不外显）。
    expect(await screen.findByText("看这个")).toBeInTheDocument();
    expect(screen.queryByText(/转发自/)).not.toBeInTheDocument();
    expect(msgs().querySelector(".forward-from")).toBeNull();
  });

  it("图片带 caption：媒体卡下方渲染 .msg-caption", async () => {
    await enterChat();
    await push(recv({ contentType: "image", content: "https://cdn/x/p.png", thumb: "data:image/jpeg;base64,z", caption: "现场照片", mediaW: 400, mediaH: 400 }));
    const cap = await screen.findByText("现场照片");
    expect(cap.closest(".msg-caption")).toBeInTheDocument();
  });
});

describe("消息列表：状态标记", () => {
  it("本人消息被对端读过 → 双勾 .ck.read（SVG 双勾）", async () => {
    await enterChat({ peer_read_seq: 5 });
    await push(recv({ from: UID, contentType: "text", content: "在的", convSeq: 1 }));
    await waitFor(() => expect(msgs().querySelector(".ck.read")).toBeInTheDocument());
  });

  // 语音气泡的时间/勾曾在组件内另算一套（多带一个 !isGroup），把 .bmeta 的判定复制成了第二份，
  // 结果单聊也好群聊也好都只显单勾。现在由 MessageList 算好 readByPeer 一并传下去，两者恒同口径。
  it("本人语音被对端读过 → 语音气泡也显双勾（与文本气泡同口径）", async () => {
    await enterChat({ peer_read_seq: 5 });
    await push(recv({ from: UID, contentType: "voice", content: "/uploads/a.m4a", duration: 3000, convSeq: 1 }));
    await waitFor(() => expect(msgs().querySelector(".voice-tick.read")).toBeInTheDocument());
  });

  it("本人语音未被读过 → 单勾（.voice-tick 不带 .read）", async () => {
    await enterChat({ peer_read_seq: 0 });
    await push(recv({ from: UID, contentType: "voice", content: "/uploads/b.m4a", duration: 3000, convSeq: 1 }));
    await waitFor(() => expect(msgs().querySelector(".voice-tick")).toBeInTheDocument());
    expect(msgs().querySelector(".voice-tick.read")).not.toBeInTheDocument();
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

  it("本人失败消息显示失败角标 .fail-badge，点它按原 clientMsgId 重发", async () => {
    await enterChat();
    await push(recv({ from: UID, contentType: "text", content: "发不出去", convSeq: 0, clientMsgId: "c-fail", status: "failed" }));
    const badge = await waitFor(() => {
      const el = msgs().querySelector(".fail-badge") as HTMLButtonElement | null;
      expect(el).toBeInTheDocument();
      return el!;
    });
    expect(badge.disabled).toBe(false);
    fireEvent.click(badge);
    // 沿用原 clientMsgId（服务端据此幂等去重；换新 ID 会让对端收到两条）。
    await waitFor(() => {
      const [content, , , , opts] = Fake.last!.calls.sendMedia?.[0] ?? [];
      expect(content).toBe("发不出去");
      expect(opts).toMatchObject({ clientMsgId: "c-fail" });
    });
  });

  it("被服务端拒收的失败消息：红❗不可点（恢复入口在下方系统行）", async () => {
    await enterChat();
    await push(recv({ from: UID, contentType: "text", content: "被拉黑了", convSeq: 0, clientMsgId: "c-rej",
                      status: "failed", note: "消息已发出，但被对方拒收了", noteCode: 200102 }));
    const badge = await waitFor(() => {
      const el = msgs().querySelector(".fail-badge") as HTMLButtonElement | null;
      expect(el).toBeInTheDocument();
      return el!;
    });
    expect(badge.disabled).toBe(true);
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

// 合并转发卡片：**卡片就是气泡**（与 iOS IMChatRecordCell 一致），时间在卡片脚注行右端。
// 旧实现是"卡片套在气泡里"——双层底色，时间还掉到卡片外下方（2026-09-05 用户实测报的样式分叉）。
describe("消息列表：合并转发卡片", () => {
  const record = JSON.stringify({ t: "群聊的聊天记录", items: [{ n: "小明", ct: "text", c: "你好" }] });

  it("外层气泡不画底色（.bubble.card），时间嵌在 .record-foot 里而不是气泡下方", async () => {
    await enterChat();
    await push(recv({ contentType: "chat_record", content: record }));
    const card = await waitFor(() => {
      const el = msgs().querySelector(".record-card") as HTMLElement | null;
      expect(el).toBeInTheDocument();
      return el!;
    });
    const bubble = card.closest(".bubble")!;
    expect(bubble).toHaveClass("card");                                   // 外层只当容器
    expect(card.querySelector(".record-foot .bmeta")).toBeInTheDocument(); // 时间在卡片脚注行内
    expect(bubble.querySelector(":scope > .bmeta")).toBeNull();           // 卡片外不再另画一行
    expect(card.querySelector(".record-foot")!.textContent).toContain("聊天记录");
  });

  it("自己发的记录卡也一样（不因收发方向漏掉脚注时间）", async () => {
    await enterChat();
    await push(recv({ from: UID, contentType: "chat_record", content: record }));
    const card = await waitFor(() => {
      const el = msgs().querySelector(".record-card") as HTMLElement | null;
      expect(el).toBeInTheDocument();
      return el!;
    });
    expect(card.closest(".row")).toHaveClass("me");
    expect(card.querySelector(".record-foot .bmeta")).toBeInTheDocument();
  });
});

describe("消息列表：通话记录（content_type=call）", () => {
  const call = (r: string, d: number, m = "video") => JSON.stringify({ cid: "call-1", m, r, d });

  it("单聊：普通气泡里图标+文字+时间；被叫未接来电走红色；不露 JSON", async () => {
    await enterChat();
    await push(recv({ contentType: "call", content: call("no_answer", 0) }));
    const text = await screen.findByText("未接来电");
    const bubble = text.closest(".bubble")!;
    expect(bubble).toHaveClass("call-bubble");
    expect(bubble.querySelector(".call-rec.missed")).toBeInTheDocument();
    expect(bubble.querySelector(".bmeta")).toBeInTheDocument();
    expect(msgs().textContent).not.toContain("cid");
  });

  it("我发的：对方已拒绝 / 通话时长，不红", async () => {
    await enterChat();
    await push(recv({ from: UID, contentType: "call", content: call("reject", 0) }));
    await push(recv({ from: UID, contentType: "call", content: call("hangup", 201, "audio") }));
    expect(await screen.findByText("对方已拒绝")).not.toHaveClass("missed");
    await screen.findByText("通话时长 03:21");
    expect(msgs().querySelector(".call-rec.missed")).toBeNull();
  });

  it("点整个气泡按原类型回拨（视频→video=true）；宿主不判忙", async () => {
    await enterChat();
    await push(recv({ contentType: "call", content: call("hangup", 5, "video") }));
    const text = await screen.findByText("通话时长 00:05");
    fireEvent.click(text.closest(".bubble")!);
    expect(placeSingleCall).toHaveBeenCalledWith(PEER, true);
  });

  it("解析失败：灰色兜底行，不可点，不露 JSON", async () => {
    await enterChat();
    await push(recv({ contentType: "call", content: "{bad" }));
    const line = await screen.findByText("[音视频通话] 请升级新版查看");
    expect(line.closest(".sys-line")).toBeInTheDocument();
    expect(msgs().textContent).not.toContain("{bad");
  });
});
