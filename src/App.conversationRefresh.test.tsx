// @vitest-environment jsdom
/**
 * 会话刷新的接线（2026-09-11）：开窗 / 翻页（live=false 批量投递）、conv_bump、实时消息都会触发会话刷新。
 * 旧写法每次都 preloadLocal(全部会话) + syncTracked(全部)。判据在 useLocalPreload.test.ts，
 * 这里只防 App 的接线被改回全量——那样界面照常，只是每翻一页历史就整份重读一遍所有会话的本地库。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChatMessage } from "./sdk/protocol";

vi.mock("./sdk/imSdk", async () => ({ IMClient: (await import("./testing/fakeIMClient")).FakeIMClient, registerAccount: vi.fn(async () => {}) }));

import { IMClient } from "./sdk/imSdk";
import type { Fake } from "./testing/fakeIMClient";
import { PEER, CID, makeConv as conv, installJsdomShims, loginAndWait } from "./testing/appHarness";

const Fake = IMClient as unknown as Fake;

const msg = (convId: string, convSeq: number): ChatMessage => ({
  convId, from: PEER, content: `#${convSeq}`, contentType: "text",
  convSeq, timestamp: Date.now(), status: "sent",
} as ChatMessage);
const count = (name: string) => Fake.last!.calls[name]?.length ?? 0;
const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  localStorage.clear();
  Fake.conversations = [conv()];
  installJsdomShims();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("会话刷新只登记新冒出来的会话", () => {
  it("开窗投递（live=false）与 conv_bump 触发的刷新：列表照拉，但不重读本地库、不发 sync", async () => {
    await loginAndWait();
    await settle();
    const loads = count("loadLocal");
    const syncs = count("syncTracked");
    const fetches = count("fetchConversations");

    await waitFor(() => { Fake.last!.handlers.onMessage!(msg(CID, 5), false); });
    await waitFor(() => expect(count("fetchConversations")).toBeGreaterThan(fetches));
    await settle();
    await waitFor(() => { Fake.last!.handlers.onConvBump!([{ conv_id: CID, latest_seq: 9 }]); });
    await waitFor(() => expect(count("fetchConversations")).toBeGreaterThan(fetches + 1));
    await settle();

    expect(count("loadLocal")).toBe(loads);
    expect(count("syncTracked")).toBe(syncs);
  });

  it("刷新里冒出一个新会话：只预载它、只同步它", async () => {
    await loginAndWait();
    await settle();
    const loads = count("loadLocal");
    Fake.conversations = [conv(), conv({ conv_id: "g_new", is_group: true, name: "新群" } as never)];

    await waitFor(() => { Fake.last!.handlers.onMessage!(msg("g_new", 1), true); });
    await waitFor(() => expect(Fake.last!.calls.syncTracked?.at(-1)).toEqual([["g_new"]]));
    expect(Fake.last!.calls.loadLocal!.slice(loads)).toEqual([["g_new"]]);
  });
});
