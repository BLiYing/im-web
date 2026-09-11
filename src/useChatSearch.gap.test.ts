// @vitest-environment jsdom
// 本地库**有缺口**时的取数分流（docs/design/OFFLINE_BACKLOG_DESIGN.md §4.9）。
//
// 这是 useChatSearch.window.test.ts 那个回归的下一章。上一章钉的是"别把渲染切片当整个会话"；
// 这一章钉的是"别把**有缺口的本地库**当整个会话"——失效方式一模一样：
// 搜索框照常显示 N/N、界面毫无异常，只是缺口里那些消息永远搜不到。
//
// 所以这里测的同样不是"能搜到"，而是**该问服务端时没问就会红**。

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { useChatSearch, type ChatSearchDeps } from "./useChatSearch";
import type { ChatMessage } from "./sdk/protocol";
import * as api from "./sdk/convQueriesApi";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.useRealTimers(); });

const CONV = "g_gap";
const msg = (seq: number, content: string): ChatMessage =>
  ({ convId: CONV, from: "u2", content, contentType: "text", convSeq: seq,
     timestamp: 1_700_000_000_000 + seq * 1000, status: "received" } as ChatMessage);

/** 本地只有尾巴 200 条（901..1100）；1..900 是离线积压留下的缺口，本地根本没有。 */
const LOCAL_TAIL = Array.from({ length: 200 }, (_, i) => msg(901 + i, `第${901 + i}条消息`));

function mount(over: Partial<ChatSearchDeps> = {}) {
  const deps: ChatSearchDeps = {
    searchOpen: true, setSearchOpen: vi.fn(),
    searchQuery: "", setSearchQuery: vi.fn(),
    allMessages: LOCAL_TAIL,
    convId: CONV, groupConvId: CONV, uid: "u1",
    groupInfos: {}, conversations: [],
    locateInChat: vi.fn(), setToast: vi.fn(),
    localComplete: true, online: true, getToken: () => "tok",
    ...over,
  };
  return renderHook((p: ChatSearchDeps) => useChatSearch(p), { initialProps: deps });
}

describe("有缺口时的搜索分流", () => {
  it("有缺口 + 在线 → 必须问服务端，且用服务端的命中集", async () => {
    const spy = vi.spyOn(api, "searchConvMessages").mockResolvedValue({
      conv_id: CONV, next_cursor: 0, has_more: false,
      // 服务端按 conv_seq **倒序**返回；Hook 内部按升序用，这里顺带钉死翻转没做反。
      items: [
        { conv_seq: 850, server_msg_id: "s850", sender: "u2", content_type: "text", content: "缺口里的那条", timestamp: 2 },
        { conv_seq: 120, server_msg_id: "s120", sender: "u2", content_type: "text", content: "更早那条", timestamp: 1 },
      ],
    });
    const { result } = mount({ searchQuery: "缺口", localComplete: false });

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][1]).toBe(CONV);
    await waitFor(() => {
      // 命中的 850 / 120 **都不在本地**——只有真的走了服务端才可能出现。
      expect(result.current.searchHits.map((m) => m.convSeq)).toEqual([120, 850]);
    });
  });

  it("本地命中先到、服务端命中后到 → 下标重置到服务端最新那条并跳过去（2026-09-11 浏览器实测撞见）", async () => {
    // 有缺口的会话里，本地那 N 条命中立刻算出来、先锁住了「默认跳最新」的签名；250ms 后服务端命中
    // 换掉命中集，签名没变就不重跳——下标还停在本地那份的最后一条上，超出服务端命中集的长度。
    // 实测表现：计数写「193 / 50+」，▲▼ 点了没反应（下标越界，gotoSearchHit 直接 return）。
    vi.spyOn(api, "searchConvMessages").mockResolvedValue({
      conv_id: CONV, next_cursor: 0, has_more: false,
      items: [
        { conv_seq: 850, server_msg_id: "s850", sender: "u2", content_type: "text", content: "第850条消息", timestamp: 2 },
        { conv_seq: 120, server_msg_id: "s120", sender: "u2", content_type: "text", content: "第120条消息", timestamp: 1 },
      ],
    });
    const locateInChat = vi.fn();
    // 「消息」在本地那 200 条里全都命中：本地命中集先到，下标先落在 199。
    const { result } = mount({ searchQuery: "消息", localComplete: false, locateInChat });
    await waitFor(() => expect(result.current.searchHits.map((m) => m.convSeq)).toEqual([120, 850]));
    await new Promise((r) => setTimeout(r, 50));   // 让 rAF 里的默认跳转落地
    expect(result.current.searchHitIdx).toBe(1);
    expect(locateInChat).toHaveBeenLastCalledWith(CONV, 850);
  });

  it("本地齐全 → 一次服务端请求都不该发（绝大多数会话走这条，行为与改造前一致）", async () => {
    const spy = vi.spyOn(api, "searchConvMessages");
    mount({ searchQuery: "第1000条", localComplete: true });
    await new Promise((r) => setTimeout(r, 400)); // 跨过防抖窗口
    expect(spy).not.toHaveBeenCalled();
  });

  it("有缺口 + 离线 → 给本地结果，但必须挂出降级提示（可以少，不可以错）", async () => {
    const spy = vi.spyOn(api, "searchConvMessages");
    const { result } = mount({ searchQuery: "第1000条", localComplete: false, online: false });
    await waitFor(() => expect(result.current.searchNotice).not.toBe(""));
    expect(spy).not.toHaveBeenCalled();
    // 本地能搜到的照常给，不因为"不完整"就整个瘫掉。
    expect(result.current.searchHits.map((m) => m.convSeq)).toEqual([1000]);
  });

  it("本地齐全时没有降级提示", async () => {
    const { result } = mount({ searchQuery: "第1000条", localComplete: true, online: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.searchNotice).toBe("");
  });
});
