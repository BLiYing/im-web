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

/** 把容器钉成「已贴底」的几何，然后派发一次滚动（向下翻页的触发条件）。 */
function scrollToBottom() {
  const box = msgs();
  Object.defineProperty(box, "scrollHeight", { value: 8000, configurable: true });
  Object.defineProperty(box, "clientHeight", { value: 500, configurable: true });
  Object.defineProperty(box, "scrollTop", { value: 7500, writable: true, configurable: true });
  fireEvent.scroll(box);
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
const loadNewerCalls = () => (Fake.last!.calls.loadNewer ?? []).map((a) => a[1] as number);

beforeEach(() => {
  localStorage.clear();
  installJsdomShims();
  // 已读到头、无未读：进会话贴底，首窗 = 最新一页。
  Fake.conversations = [makeConv({ latest_conv_seq: HEAD, read_seq: HEAD, unread: 0 })];
  Fake.ranges = []; Fake.head = 0; Fake.floor = 0; // 取数分流的三个输入，逐例自己摆
});
afterEach(() => {
  Fake.ranges = []; Fake.head = 0; Fake.floor = 0;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function enterWithLatestPage() {
  await enterChat();
  deliver(HEAD - PAGE + 1, HEAD); // [29802..30001]
  await waitFor(() => expect(renderedSeqs().length).toBe(PAGE));
  expect(renderedSeqs()[0]).toBe(HEAD - PAGE + 1);
}

describe("进会话取哪一窗：判据是**真实未读数**，不是 latest>read", () => {
  const openArgs = () => (Fake.last!.calls.openConversation ?? []).map((a) => a as [string, number, number, number]);

  it("发送方（unread=0 但读位点远落后于自己发的消息）→ 取最近一页贴底，不锚到旧位点", async () => {
    // 压测现场：user1001 用脚本往群里灌了 1 万条，那些消息都是**它自己发的**。
    // 服务端未读计数排除本人消息（CountUnreadSince 带 sender <> ?），故 unread=0，
    // 但 read_seq 停在灌之前。旧判据 latest>read 成立 → 锚到一万条之前，进会话不贴底、↓N 一大串。
    Fake.conversations = [makeConv({ latest_conv_seq: HEAD, read_seq: HEAD - 10000, unread: 0 })];
    await enterChat();
    const [, readSeq, latestSeq, unread] = openArgs()[0];
    expect(unread).toBe(0);
    expect(readSeq).toBe(HEAD - 10000);
    expect(latestSeq).toBe(HEAD);
  });

  it("真有未读时仍按未读锚定（别把上面那条修成「永远贴底」）", async () => {
    Fake.conversations = [makeConv({ latest_conv_seq: HEAD, read_seq: HEAD - 10000, unread: 9000 })];
    await enterChat();
    expect(openArgs()[0][3]).toBe(9000);
  });
});

describe("首次登录（read_seq=0）进大群：停在会话开头，一路往下读要接得上", () => {
  const openArgs = () => (Fake.last!.calls.openConversation ?? []).map((a) => a as [string, number, number, number]);

  beforeEach(() => {
    // 首次登录的新成员：一条都没读过（read_seq=0）、未读撞服务端上限（10000）、会话最新到 30001。
    Fake.conversations = [makeConv({ latest_conv_seq: HEAD, read_seq: 0, unread: 10000, unread_capped: true })];
  });

  it("read_seq=0 且有未读 → 按未读锚定（不是「没有可锚的位点」，别再退回贴底）", async () => {
    await enterChat();
    const [, readSeq, latestSeq, unread] = openArgs()[0];
    expect(readSeq).toBe(0);
    expect(unread).toBe(10000);
    expect(latestSeq).toBe(HEAD);
    // 取哪一窗由 planEntryWindow 决定（见 windowPlan.test.ts）：unread>0 ⇒ 锚到 readSeq=0，
    // 即会话开头那一段，而不是最新一页。这里钉的是 App 把三个入参**原样**交出去。
  });

  it("往下翻页：窗口先长到上限再滑动，且每一页都还能继续翻（忙标志复位）", async () => {
    await enterChat();
    deliver(1, PAGE);                                   // 首屏 = 会话开头那一页
    await waitFor(() => expect(renderedSeqs().length).toBe(PAGE));
    expect(renderedSeqs()[0]).toBe(1);

    // 第 1 次下翻：窗口 200 → 400，上沿仍是 1 ⇒ 新内容纯粹接在下方，位置本就不用补偿。
    scrollToBottom();
    await waitFor(() => expect(loadNewerCalls()).toEqual([PAGE]));
    deliver(PAGE + 1, PAGE * 2);
    await waitFor(() => expect(renderedSeqs().length).toBe(PAGE * 2));
    expect(renderedSeqs()[0]).toBe(1);

    // 第 2 次：400 → 600（封顶），上沿依旧是 1。
    scrollToBottom();
    await waitFor(() => expect(loadNewerCalls()).toEqual([PAGE, PAGE * 2]));
    deliver(PAGE * 2 + 1, PAGE * 3);
    await waitFor(() => expect(renderedSeqs().length).toBe(PAGE * 3));
    expect(renderedSeqs()[0]).toBe(1);

    // 第 3 次：已封顶 ⇒ 窗口**滑动**，上沿前移、条数不变（忙标志靠窗口签名里的 min 复位，
    // 不是靠条数——条数在这一步纹丝不动，见下方 ⑤ 那条同源教训）。
    scrollToBottom();
    await waitFor(() => expect(loadNewerCalls()).toEqual([PAGE, PAGE * 2, PAGE * 3]));
    deliver(PAGE * 3 + 1, PAGE * 4);
    await waitFor(() => expect(renderedSeqs()[0]).toBeGreaterThan(1));
    expect(renderedSeqs().length).toBe(PAGE * 3);       // 封顶：DOM 不会一路长下去
    expect(Math.max(...renderedSeqs())).toBe(PAGE * 4);

    // 还能继续（不是滑一次就卡死）。
    scrollToBottom();
    await waitFor(() => expect(loadNewerCalls().length).toBe(4));
    // 注：滑动那一下的**像素级落点**（按同一条消息补偿）在 jsdom 里验不了——
    // getBoundingClientRect 恒 0。这里只钉「窗口怎么走」，落点靠浏览器手测。
  }, 30000);
});

describe("渲染窗口有硬上限：向上翻页只滑动、不无限长", () => {
  it("本地很大时连翻多次，渲染行数封顶在 3 页且窗口确实在往前走", async () => {
    // 现场：本地已有 2000 条（首次 sync 灌进来的），用户一路往上翻。
    // 改之前是 size += 200 一路加到本地全量——浏览器实测每翻一次 +200 行 / +1400 个 DOM 节点，
    // 翻 6 次到 1400 行，二十来次就回到 W2 当初要消灭的量级（4199 行 / 29537 节点）。
    const LOCAL = 2000;
    Fake.conversations = [makeConv({ latest_conv_seq: LOCAL, read_seq: LOCAL, unread: 0 })];
    await enterChat();
    deliver(1, LOCAL);
    await waitFor(() => expect(renderedSeqs().length).toBe(PAGE));

    // 5 轮：窗口先长到上限（200→400→600），随后每轮滑动半窗（-300）。
    // 刻意不翻到会话开头——那时上方没得翻了，"每轮都往前走"自然不再成立，与本例要钉的东西无关。
    let top = renderedSeqs()[0];
    for (let i = 0; i < 5; i++) {
      const prevTop = top;
      scrollToTop();
      await waitFor(() => expect(renderedSeqs()[0]).toBeLessThan(prevTop)); // 每一轮都真的往前走
      top = renderedSeqs()[0];
      // 封顶：本地有 2000 条也不会全渲染出来。
      expect(renderedSeqs().length).toBeLessThanOrEqual(PAGE * 3);
    }
    // 翻了 8 轮，窗口早已越过 600 条的位置，但渲染集始终没超过上限。
    expect(top).toBeLessThan(LOCAL - PAGE * 3);
  }, 20000);
});

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

// ==========================================================================================
// C3 取数分流（OFFLINE_BACKLOG_DESIGN §4.6/§4.7）：上滑之前**先查区间清单**，
// 本地这一段之上还有已下载的内容就直接展开，不打网络。
//
// 判据必须是清单、不是 seq 连不连号——判据的纯逻辑在 windowPlan.test.ts 钉过了，
// 这里钉的是**接线**：App 真的把清单喂给了那个判据，且判据的答案真的决定了发不发请求。
// 接线错了纯函数测试一条都不会红（2026-09-03 的教训：判据对、调用点没接上，等于没做）。
// ==========================================================================================
describe("C3 上滑取数分流：先查区间清单再决定问不问服务端", () => {
  it("清单说上沿还在段中间 → 只展开本地，一个请求都不发", async () => {
    // 本地其实有 [1..30001] 整段，只是渲染窗口停在最后 200 条。
    Fake.ranges = [{ lo: 1, hi: HEAD }];
    await enterChat();
    deliver(HEAD - PAGE * 2 + 1, HEAD);           // 本地灌 400 条，窗口先渲染 200
    await waitFor(() => expect(renderedSeqs().length).toBe(PAGE));
    scrollToTop();
    await waitFor(() => expect(renderedSeqs().length).toBeGreaterThan(PAGE)); // 窗口长大了
    expect(loadOlderCalls()).toEqual([]);          // 本地够用 ⇒ 没问服务端
  });

  // C3 的核心：29802 与 29801 之间隔着 msg_op 事件行 / 墓碑（占了 conv_seq 却不成为消息）。
  // 旧判据「本地有没有 seq-1 这条消息」在这里判"不连续"→ 空跑一次请求，还提前把窗口切进锚点模式。
  it("上沿的前一号是占号行（本地没有那条消息）但清单说齐全 → 仍然不发请求", async () => {
    Fake.ranges = [{ lo: 1, hi: HEAD }];
    await enterChat();
    // 故意在 29801 处留一个"洞"：那一号是事件行，不会有消息，但它在清单覆盖范围内。
    act(() => {
      for (let sq = HEAD - PAGE * 2 + 1; sq <= HEAD; sq++) {
        if (sq === HEAD - PAGE) continue;          // 跳过 29801
        Fake.last!.handlers.onMessage!(msg(sq));
      }
    });
    await waitFor(() => expect(renderedSeqs().length).toBe(PAGE));
    expect(renderedSeqs()[0]).toBe(HEAD - PAGE + 1); // 上沿仍是 29802
    scrollToTop();
    await waitFor(() => expect(renderedSeqs().length).toBeGreaterThan(PAGE));
    expect(loadOlderCalls()).toEqual([]);
  });

  it("清单说上面还有、但内存里一条更早的都没有 → 仍旧问服务端（不许无声卡住）", async () => {
    // 清单可以合法地覆盖一段没有任何消息的号（整段都是 msg_op 事件行 / 墓碑）。
    // 只信清单的话：展开分支展不出东西、滑窗分支把锚点定在原地，上滑永远不动也永远不发请求。
    Fake.ranges = [{ lo: 1, hi: HEAD }];
    await enterWithLatestPage();          // 内存里只有 [29802..30001]，上沿之上一条都没有
    scrollToTop();
    await waitFor(() => expect(loadOlderCalls()).toEqual([HEAD - PAGE + 1]));
  });

  it("清单说上沿正是段首（上面是真缺口）→ 照旧向服务端要一页", async () => {
    Fake.ranges = [{ lo: HEAD - PAGE + 1, hi: HEAD }];
    await enterWithLatestPage();
    scrollToTop();
    await waitFor(() => expect(loadOlderCalls()).toEqual([HEAD - PAGE + 1]));
  });

  it("上沿正踩在服务端说过的可见下界上 → 不再空跑请求", async () => {
    // G2 把新成员的可见下界抬到入群位点，`上沿 > 1` 这个猜法对他们恒真：
    // 不认这条权威答案的话，每次上滑都要空跑一次注定回空页的请求。
    Fake.ranges = [{ lo: HEAD - PAGE + 1, hi: HEAD }];
    Fake.floor = HEAD - PAGE + 1;                 // 下界就是当前上沿
    await enterWithLatestPage();
    scrollToTop();
    scrollToTop();
    expect(loadOlderCalls()).toEqual([]);
  });

  // /code-review 2026-09-09：第一版把下界记成布尔。从搜索结果跳进一个旧岛、上滑到岛顶时
  // 服务端同样回 has_before=false（它是相对**本窗下沿**说的），记成布尔就等于宣布"整条会话
  // 到顶了"——回到最新那一段再上滑会被永久静默屏蔽，中间那段缺口再也补不上。
  it("下界是从旧岛记下的（远低于当前上沿）→ 当前这一段照旧要问服务端", async () => {
    Fake.ranges = [{ lo: HEAD - PAGE + 1, hi: HEAD }];
    Fake.floor = 1;                               // 旧岛顶部记下的下界
    await enterWithLatestPage();
    scrollToTop();
    await waitFor(() => expect(loadOlderCalls()).toEqual([HEAD - PAGE + 1]));
  });
});
