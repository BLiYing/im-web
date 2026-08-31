// @vitest-environment jsdom
// 会话内搜索 / 日历 / 「来自」候选 在**渲染窗口**下的取数口径（MESSAGE_WINDOW_DESIGN §5.1）。
//
// 钉的是一个真实回归：W2 给消息列表加渲染窗口后，这个 Hook 一度收到的是**渲染切片**而不是
// 本地全量。表现极其隐蔽——搜索框照常显示 "N / N"、界面毫无异常，只是命中集悄悄缩成了
// 「看得见的那 200 条」（3 万条的群里实测只命中 98 条）。
// 所以这里不测"能搜到"，测的是**搜不到窗口外的东西时会红**。
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useChatSearch, type ChatSearchDeps } from "./useChatSearch";
import type { ChatMessage } from "./sdk/protocol";
afterEach(cleanup);

const CONV = "g_win";
const msg = (seq: number, content: string, from = "u2"): ChatMessage =>
  ({ convId: CONV, from, content, contentType: "text", convSeq: seq, timestamp: 1_700_000_000_000 + seq * 1000, status: "received" } as ChatMessage);

/** 会话全量 500 条；「渲染窗口」只有最后 200 条——两者的差集就是这次回归的作案现场。 */
const ALL = Array.from({ length: 500 }, (_, i) => msg(i + 1, `第${i + 1}条消息`));

function mount(over: Partial<ChatSearchDeps> = {}) {
  const locateInChat = vi.fn();
  const deps: ChatSearchDeps = {
    searchOpen: true, setSearchOpen: vi.fn(),
    searchQuery: "", setSearchQuery: vi.fn(),
    allMessages: ALL,
    convId: CONV, groupConvId: CONV, uid: "u1",
    groupInfos: {}, conversations: [],
    locateInChat, setToast: vi.fn(),
    ...over,
  };
  return { ...renderHook((p: ChatSearchDeps) => useChatSearch(p), { initialProps: deps }), deps, locateInChat };
}

describe("useChatSearch 在渲染窗口下的取数口径", () => {
  it("命中集来自本地全量：窗口外（第 7 条）也搜得到", () => {
    // 若这个 Hook 拿到的是渲染切片（末 200 条 = 301..500），第 7 条搜不到 → 本用例红。
    const { result } = mount({ searchQuery: "第7条" });
    expect(result.current.searchHits.map((m) => m.convSeq)).toEqual([7]);
  });

  it("命中集升序且覆盖整个会话，不只是末尾一窗", () => {
    const { result } = mount({ searchQuery: "第1条消息" }); // 命中 1 与 501+（本例只有 1）
    const seqs = result.current.searchHits.map((m) => m.convSeq);
    expect(seqs).toEqual([1]);
    const many = mount({ searchQuery: "第10" }); // 10,100..109 —— 全在窗口外
    const s2 = many.result.current.searchHits.map((m) => m.convSeq);
    expect(s2[0]).toBe(10);
    expect(s2).toEqual([...s2].sort((a, b) => a - b));
    expect(s2.every((s) => s <= 300)).toBe(true); // 确实全落在"渲染窗口之外"的那一段
  });

  it("跳到命中走 locateInChat（跨窗口），不是只滚 DOM 的 jumpToSeq", () => {
    // 这条是配套约束：命中集既然可能在窗口外，跳转就必须走能换窗的那个入口。
    // 用只滚 DOM 的 jumpToSeq 会弹「原消息较早，请上拉加载后重试」——功能形同虚设。
    const { result, locateInChat } = mount({ searchQuery: "第7条" });
    act(() => result.current.gotoSearchHit(0));
    expect(locateInChat).toHaveBeenCalledWith(CONV, 7);
  });

  it("「来自」候选取自本地全量：只在窗口外发过言的人也在候选里", () => {
    const withGhost = [msg(3, "很早以前", "ghost"), ...ALL];
    const { result } = mount({ allMessages: withGhost });
    act(() => result.current.openFromPicker()); // 候选只在面板打开时才算
    // ghost 只在第 3 条发过言（远在末 200 条之外）：拿渲染切片的话它不会出现在候选里。
    expect(result.current.searchFromRows.map((r) => r.userId)).toContain("ghost");
  });

  it("日历活跃日取自本地全量：跨越窗口外的日期也点亮", () => {
    const day2 = 1_700_000_000_000 + 86_400_000 * 3;
    const spread = [{ ...msg(2, "很早"), timestamp: day2 } as ChatMessage, ...ALL];
    const { result } = mount({ allMessages: spread });
    expect(result.current.activeDays.size).toBeGreaterThan(1);
  });
});
