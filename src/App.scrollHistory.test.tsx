// @vitest-environment jsdom
/**
 * 上滑翻历史：定长滑动窗口 × 分页忙标志（2026-09-03 libeyond↔user1001 三万条会话实测现场）。
 *
 * 现场：积压超过 max_gap → 本地只有进会话拉的最新一页 [29802..30001]。上滑到 29802 后：
 *   ① 该向服务端要更早一页（本地在上沿之上不连续）；
 *   ② 那页回来后窗口要真的往前滑（用户看得到 29802 之前的消息）；
 *   ③ 滑完之后**再上滑仍能继续翻**——窗口恒 200 条，条数不变，只靠 messages.length 触发的
 *      effect 不重跑、忙标志复位不了，之后每次上滑都被当 busy 跳过，这就是"停在首页上沿"的根子；
 *   ④ 一页回来但没带来任何新消息（全被去重 / 空页）也必须解除忙标志，否则同样卡死。
 *
 * 滚动几何在 jsdom 里全是 0（nearBottom 恒真、scrollTop 恒 0），得手工钉在容器上；
 * 位置补偿走 getBoundingClientRect（jsdom 全 0）→ 这里只断言窗口与请求，不断言像素。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChatMessage } from "./sdk/protocol";

vi.mock("./sdk/imSdk", async () => ({ IMClient: (await import("./testing/fakeIMClient")).FakeIMClient, registerAccount: vi.fn(async () => {}) }));

import { IMClient } from "./sdk/imSdk";
import type { Fake } from "./testing/fakeIMClient";
import { PEER, CID, makeConv, installJsdomShims, enterChat } from "./testing/appHarness";
const Fake = IMClient as unknown as Fake;

const HEAD = 30001;
const PAGE = 200;

const msg = (seq: number): ChatMessage => ({
  convId: CID, from: PEER, content: `#${seq}`, contentType: "text",
  convSeq: seq, timestamp: 1_700_000_000_000 + seq, status: "sent",
} as ChatMessage);

const msgs = () => document.querySelector(".msgs") as HTMLElement;
const renderedSeqs = () => [...document.querySelectorAll<HTMLElement>(".msg-item[data-seq]")].map((el) => Number(el.dataset.seq));

/** 一次性灌入 [lo, hi] 这一段（同一 act：模拟同一帧 sync_resp 里的整页）。 */
function deliver(lo: number, hi: number) {
  act(() => { for (let s = lo; s <= hi; s++) Fake.last!.handlers.onMessage!(msg(s)); });
}

/** 把容器钉成「在顶部、离底很远」的几何，然后派发一次滚动。 */
function scrollToTop() {
  const box = msgs();
  Object.defineProperty(box, "scrollHeight", { value: 8000, configurable: true });
  Object.defineProperty(box, "clientHeight", { value: 500, configurable: true });
  Object.defineProperty(box, "scrollTop", { value: 0, writable: true, configurable: true });
  fireEvent.scroll(box);
}

const loadOlderCalls = () => (Fake.last!.calls.loadOlder ?? []).map((a) => a[1] as number);

beforeEach(() => {
  localStorage.clear();
  installJsdomShims();
  // 已读到头、无未读：进会话贴底，首窗 = 最新一页。
  Fake.conversations = [makeConv({ latest_conv_seq: HEAD, read_seq: HEAD, unread: 0 })];
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function enterWithLatestPage() {
  await enterChat();
  deliver(HEAD - PAGE + 1, HEAD); // [29802..30001]
  await waitFor(() => expect(renderedSeqs().length).toBe(PAGE));
  expect(renderedSeqs()[0]).toBe(HEAD - PAGE + 1);
}

describe("↓N 角标：锚点模式（上翻过一页后，窗口不含尾部）", () => {
  const badge = () => document.querySelector(".jump-badge")?.textContent ?? "";

  // 显式放宽超时：本例要把 600 条消息逐条过一遍 React（进会话 200 + 翻一页 200 + 尾部 1，
  // 每条都触发 ingest/渲染/可见即读扫描），单独跑约 1.6s，但全量并行时机器负载高，
  // 默认 5s 会偶发超时。放宽的是**预算**不是断言——断言本身仍然精确。
  it("读历史期间来的对端消息要计入角标，不能等滚回底才看见", async () => {
    await enterWithLatestPage(); // 本地只有 [29802..30001]

    // 上滑一次 → 切进锚点模式并向服务端要一页；这页回来后窗口停在历史里、**不含尾部**。
    scrollToTop();
    deliver(HEAD - 2 * PAGE + 1, HEAD - PAGE);
    act(() => { Fake.last!.handlers.onHistoryPage!(CID, HEAD - 2 * PAGE, PAGE); });
    await waitFor(() => expect(renderedSeqs()[0]).toBeLessThan(HEAD - PAGE + 1));
    expect(Math.max(...renderedSeqs())).toBeLessThan(HEAD); // 前提：尾部确实已不在 DOM 里
    const before = Number(badge() || 0);

    // 此刻对端发来一条：它只进本地全量，不进这一窗。
    // 修复前角标只数 DOM、且重算 effect 只看窗口条数 → 纹丝不动，用户毫不知情。
    deliver(HEAD + 1, HEAD + 1);
    await waitFor(() => expect(Number(badge() || 0)).toBe(before + 1));
  }, 15000);
});

describe("上滑翻历史：本地在上沿之上不连续 → 向服务端要一页", () => {
  it("上滑一次即发 loadOlder(上沿)；页回来后窗口往前滑，再上滑还能继续翻（忙标志已复位）", async () => {
    await enterWithLatestPage();

    scrollToTop();
    expect(loadOlderCalls()).toEqual([HEAD - PAGE + 1]); // loadOlder(cid, 29802)

    // 服务端回 [29602..29801]，随后 SDK 报「这页结束了」。
    deliver(HEAD - 2 * PAGE + 1, HEAD - PAGE);
    act(() => { Fake.last!.handlers.onHistoryPage!(CID, HEAD - 2 * PAGE, PAGE); });
    await waitFor(() => expect(renderedSeqs()[0]).toBeLessThan(HEAD - PAGE + 1)); // ② 窗口真的往前滑了
    expect(renderedSeqs().length).toBe(PAGE);                                    // 定长：条数不变

    // ③ 关键：条数没变也得能继续翻。本地此刻在上沿之上是连着的（29602.. 都在），这一步先展开本地；
    scrollToTop();
    await waitFor(() => expect(renderedSeqs()[0]).toBe(HEAD - 2 * PAGE + 1)); // 展开到 29602
    expect(loadOlderCalls()).toEqual([HEAD - PAGE + 1]);                        // 本地有的不发请求

    // 本地见底 → 再上滑必须再次向服务端要。修复前这里永远不会有第二次调用（busy 卡死）。
    scrollToTop();
    await waitFor(() => expect(loadOlderCalls()).toEqual([HEAD - PAGE + 1, HEAD - 2 * PAGE + 1]));
  });

  it("④ 一页回来却一条新消息都没带（去重/空页）也要解除忙标志，下次上滑照常再问", async () => {
    await enterWithLatestPage();

    scrollToTop();
    expect(loadOlderCalls()).toEqual([HEAD - PAGE + 1]);

    // 响应到了但空页（如可见下界 / 全被「仅为我删除」过滤）：渲染集纹丝不动。
    act(() => { Fake.last!.handlers.onHistoryPage!(CID, HEAD - 2 * PAGE, 0); });
    expect(renderedSeqs()[0]).toBe(HEAD - PAGE + 1);

    scrollToTop();
    await waitFor(() => expect(loadOlderCalls()).toEqual([HEAD - PAGE + 1, HEAD - PAGE + 1]));
  });

  it("⑤ 没有「页结束」回调、只靠消息逐条上屏时，窗口滑动本身也要复位忙标志（effect 须依赖窗口签名而非条数）", async () => {
    await enterWithLatestPage();
    scrollToTop();
    expect(loadOlderCalls()).toEqual([HEAD - PAGE + 1]);

    deliver(HEAD - 2 * PAGE + 1, HEAD - PAGE); // 页到了，但刻意不报 onHistoryPage
    await waitFor(() => expect(renderedSeqs()[0]).toBeLessThan(HEAD - PAGE + 1));
    expect(renderedSeqs().length).toBe(PAGE); // 条数没变——修复前 effect 就在这里不重跑

    // 本地在上沿之上是连着的 → 该展开本地；忙标志没复位的话这一步会被当 busy 跳过、窗口纹丝不动。
    scrollToTop();
    await waitFor(() => expect(renderedSeqs()[0]).toBe(HEAD - 2 * PAGE + 1));
  });

  it("页还没回来时上滑不重复发请求（在途守卫仍然有效）", async () => {
    await enterWithLatestPage();
    scrollToTop();
    scrollToTop();
    scrollToTop();
    expect(loadOlderCalls()).toEqual([HEAD - PAGE + 1]);
  });
});
