// @vitest-environment jsdom
/**
 * 跨窗口定位（置顶横幅 / 引用条 / 搜索命中 / 日历「最早」/ 详情页「定位到聊天」共用同一条路）。
 *
 * 现场（2026-09-05 用户实测，20000 人大群 + 13 万条单聊）：
 *   ① 点置顶消息**要点两次**才过去。第一次只把那一段灌进本地库，渲染窗口还钉在贴最新那一段，
 *      目标压根没有 DOM 节点；第二次才因为"本地已有"走到移窗分支。
 *   ② 点搜索里的「最早」跳不到会话首条——它以 conv_seq=1 为锚点，而 1 号常常不是一条消息
 *      （msg_op 事件行 / 墓碑 / 入群前对我不可见的行都占号），服务端回 anchor_found=false，
 *      于是明明整段最早历史都回来了，客户端还是报一句假的「原消息已被删除」。
 *   ③ 跳到历史后往下滚**回不到最新**：判据比的是"本地数组最后一个元素"，而本地库按**到达顺序**
 *      存，开窗取回的旧消息恰恰追加在末尾。
 *
 * 滚动几何在 jsdom 里全是 0，故这里只断言「哪些 seq 被渲染出来 / 有没有高亮」，不断言像素。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, waitFor, act, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChatMessage, PinnedMessage } from "./sdk/protocol";

vi.mock("./sdk/imSdk", async () => ({ IMClient: (await import("./testing/fakeIMClient")).FakeIMClient, registerAccount: vi.fn(async () => {}) }));

import { IMClient } from "./sdk/imSdk";
import type { Fake } from "./testing/fakeIMClient";
import { PEER, CID, makeConv, installJsdomShims, enterChat } from "./testing/appHarness";
const Fake = IMClient as unknown as Fake;

const HEAD = 500;
const PIN_SEQ = 7;

const msg = (seq: number): ChatMessage => ({
  convId: CID, from: PEER, content: `#${seq}`, contentType: "text",
  convSeq: seq, timestamp: 1_700_000_000_000 + seq, status: "sent",
} as ChatMessage);

const pin = (convSeq: number): PinnedMessage => ({
  convSeq, serverMsgId: `s${convSeq}`, from: PEER, contentType: "text",
  content: `#${convSeq}`, timestamp: 1_700_000_000_000 + convSeq, pinnedAt: Date.now(),
});

const msgsBox = () => document.querySelector(".msgs") as HTMLElement;
const renderedSeqs = () => [...document.querySelectorAll<HTMLElement>(".msg-item[data-seq]")].map((el) => Number(el.dataset.seq));
const deliver = (lo: number, hi: number) => act(() => { for (let s = lo; s <= hi; s++) Fake.last!.handlers.onMessage!(msg(s)); });

/**
 * 让 requestWindow 表现得像服务端：先把这一段灌进本地库，再回 window_resp。
 * `deliverFrom` 允许模拟"锚点本身不是消息"（如 anchor=1 是一条 msg_op 事件行）。
 */
function serveWindow({ anchorFound, deliverFrom, deliverTo }: { anchorFound: boolean; deliverFrom: number; deliverTo: number }) {
  const client = Fake.last as unknown as Record<string, unknown>;
  client.requestWindow = (convId: string, anchor: number) => {
    act(() => {
      for (let s = deliverFrom; s <= deliverTo; s++) Fake.last!.handlers.onMessage!(msg(s));
      Fake.last!.handlers.onWindow!({ convId, anchor, anchorFound, hasBefore: deliverFrom > 1, hasAfter: true });
    });
  };
}

/** 进会话并灌满尾段 [401..500]，此时本地**没有**开头那几十条。 */
async function enterWithTail() {
  await enterChat();
  deliver(HEAD - 99, HEAD);
  await waitFor(() => expect(renderedSeqs()).toContain(HEAD));
}

beforeEach(() => {
  localStorage.clear();
  Fake.conversations = [makeConv({ latest_conv_seq: HEAD })];
  Fake.pinned = [];
  installJsdomShims();
});
afterEach(() => { cleanup(); Fake.pinned = []; vi.restoreAllMocks(); });

describe("跨窗口定位：一次点击就该到位", () => {
  it("目标不在本地时，开窗回来后**自动移窗并高亮**（不需要再点第二次）", async () => {
    Fake.pinned = [pin(PIN_SEQ)];
    await enterWithTail();
    await waitFor(() => expect(document.querySelector(".pin-banner")).toBeInTheDocument());
    serveWindow({ anchorFound: true, deliverFrom: 1, deliverTo: 60 });

    fireEvent.click(document.querySelector(".pin-banner-main")!);

    // 一次点击：目标要真的渲染出来并高亮。旧实现在这里只会渲染尾段（401..500）。
    await waitFor(() => expect(renderedSeqs()).toContain(PIN_SEQ));
    await waitFor(() => expect(document.querySelector(`.msg-item[data-seq="${PIN_SEQ}"]`)).toHaveClass("flash"));
  });

  // 开过窗、消息也灌进来了，却仍找不到锚点 → 它是一条永远不会成为消息的行
  //（服务端 anchor_found 只保证 im_message 里有这一行，msg_op 事件行同样在那张表里）。
  // 必须就此打住并提示：不打住的话 effect 会一轮轮重开同一个窗，无限往返。
  it("开窗后锚点仍不成为消息 → 提示一次并停手，不无限重开窗", async () => {
    Fake.pinned = [pin(PIN_SEQ)];
    await enterWithTail();
    await waitFor(() => expect(document.querySelector(".pin-banner")).toBeInTheDocument());
    serveWindow({ anchorFound: true, deliverFrom: 20, deliverTo: 60 }); // 就是不给 PIN_SEQ

    fireEvent.click(document.querySelector(".pin-banner-main")!);

    await waitFor(() => expect(screen.getByText("原消息已被删除")).toBeInTheDocument());
    const opened = (Fake.last!.calls["requestWindow"] ?? []).length;
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect((Fake.last!.calls["requestWindow"] ?? []).length).toBe(opened); // 没有再开第二次
  });
});

describe("跳到历史之后，必须有回程", () => {
  // 用户报的就是这一条：「点击置顶消息，无法一次回到消息位置」。
  // showJump 原先只在 onMsgsScroll 与进会话的 layout effect 里算，而**跳转本身不产生滚动事件**；
  // 跳到的那一段又常常整屏就放得下（实测 20000 人大群点置顶落在 13 条的旧岛上，
  // scrollHeight 695 / 视口 650，只剩 45px 可滚且已在底部）——滚不出事件，
  // onMsgsScroll 里"贴底且窗口不在本地末尾就回到贴最新"的兜底也永远轮不到，
  // 于是既没有按钮也没有兜底，只能切走会话再切回来。iOS 的 openLocalWindowAroundConvSeq
  // 末尾一直有一句 updateJumpButton，Web 缺的就是它。
  it("窗口停在历史某一段 → 「回到最新」按钮必须出现（哪怕那一段整屏放得下）", async () => {
    Fake.pinned = [pin(PIN_SEQ)];
    await enterWithTail();
    await waitFor(() => expect(document.querySelector(".pin-banner")).toBeInTheDocument());
    expect(document.querySelector(".jump-btn")).toBeNull(); // 贴最新时本就不该有
    serveWindow({ anchorFound: true, deliverFrom: 1, deliverTo: 60 });

    fireEvent.click(document.querySelector(".pin-banner-main")!);

    await waitFor(() => expect(renderedSeqs()).toContain(PIN_SEQ));
    await waitFor(() => expect(document.querySelector(".jump-btn")).toBeInTheDocument());
  });

  it("点它回到贴最新，按钮随之收起", async () => {
    Fake.pinned = [pin(PIN_SEQ)];
    await enterWithTail();
    await waitFor(() => expect(document.querySelector(".pin-banner")).toBeInTheDocument());
    serveWindow({ anchorFound: true, deliverFrom: 1, deliverTo: 60 });
    fireEvent.click(document.querySelector(".pin-banner-main")!);
    await waitFor(() => expect(document.querySelector(".jump-btn")).toBeInTheDocument());

    act(() => { fireEvent.click(document.querySelector(".jump-btn")!); });
    await waitFor(() => expect(renderedSeqs()).toContain(HEAD));
    await waitFor(() => expect(document.querySelector(".jump-btn")).toBeNull());
  });
});

describe("搜索「最早」：锚点 1 号常常不是一条消息", () => {
  /** 打开会话内搜索的日历面板，点「最早」。 */
  async function clickEarliest() {
    fireEvent.click(document.querySelector('[title="搜索聊天内容"]')!);
    await waitFor(() => expect(document.querySelector('[title="按日期"]')).toBeInTheDocument());
    fireEvent.click(document.querySelector('[title="按日期"]')!);
    await waitFor(() => expect(screen.getByText("最早")).toBeInTheDocument());
    fireEvent.click(screen.getByText("最早"));
  }

  it("服务端说 anchor_found=false，但这一窗带回了最早那一段 → 落到实际最早的一条", async () => {
    await enterWithTail();
    // 1 号是一条 msg_op 事件行：服务端查得到、客户端永远不会把它变成消息。
    serveWindow({ anchorFound: false, deliverFrom: 3, deliverTo: 60 });

    await clickEarliest();

    await waitFor(() => expect(renderedSeqs()).toContain(3));
    expect(screen.queryByText("原消息已被删除")).toBeNull();
  });
});

describe("跳到历史之后，往下滚要能回到最新", () => {
  it("窗口停在旧的一段时，滚到底自动回到贴最新", async () => {
    Fake.pinned = [pin(PIN_SEQ)];
    await enterWithTail();
    await waitFor(() => expect(document.querySelector(".pin-banner")).toBeInTheDocument());
    serveWindow({ anchorFound: true, deliverFrom: 1, deliverTo: 60 });
    fireEvent.click(document.querySelector(".pin-banner-main")!);
    await waitFor(() => expect(renderedSeqs()).toContain(PIN_SEQ));
    expect(renderedSeqs()).not.toContain(HEAD); // 窗口确实挪到了旧的那一段

    // 判据比的若是"本地数组最后一个元素"，这里恒等（开窗取回的旧消息就追加在数组末尾），
    // 于是这一支永远不触发——滚到底纹丝不动。
    const box = msgsBox();
    Object.defineProperty(box, "scrollHeight", { value: 8000, configurable: true });
    Object.defineProperty(box, "clientHeight", { value: 500, configurable: true });
    Object.defineProperty(box, "scrollTop", { value: 7500, writable: true, configurable: true });
    fireEvent.scroll(box);

    await waitFor(() => expect(renderedSeqs()).toContain(HEAD));
  });
});
