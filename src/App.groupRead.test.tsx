// @vitest-environment jsdom
/**
 * 群「全员已读」实时帧 group_read（IMServer docs/design/GROUP_READ_REALTIME_DESIGN.md）：
 * 停在群聊页时收到 group_read，我发的、conv_seq ≤ 该位点的消息不刷新列表、不切会话就变双勾；
 * 位点只增不减（迟到的小值不能把双勾退回去）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChatMessage } from "./sdk/protocol";

vi.mock("./sdk/imSdk", async () => ({ IMClient: (await import("./testing/fakeIMClient")).FakeIMClient, registerAccount: vi.fn(async () => {}) }));

import { IMClient } from "./sdk/imSdk";
import type { Fake } from "./testing/fakeIMClient";
import { UID, makeConv as conv, installJsdomShims, enterChat } from "./testing/appHarness";

const Fake = IMClient as unknown as Fake;
const GID = "g_readrt";
const mine = (convSeq: number): ChatMessage => ({
  convId: GID, from: UID, content: `#${convSeq}`, contentType: "text",
  convSeq, timestamp: Date.now(), status: "sent",
} as ChatMessage);
const msgs = () => document.querySelector(".msgs") as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  // 群名沿用 harness 等待的「小明」，loginAndWait / openChatWithPeer 不用另写一套
  Fake.conversations = [conv({ conv_id: GID, is_group: true, name: "小明", peer: "", group_read_seq: 0 } as never)];
  installJsdomShims();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("群聊 group_read 实时帧", () => {
  it("收到 group_read → 位点以内的本人消息变双勾，位点之外的仍单勾；小值不回退", async () => {
    await enterChat();
    await waitFor(() => { Fake.last!.handlers.onMessage!(mine(1)); });
    await waitFor(() => { Fake.last!.handlers.onMessage!(mine(2)); });
    await waitFor(() => expect(msgs().querySelectorAll(".ck").length).toBe(2));
    expect(msgs().querySelector(".ck.read")).not.toBeInTheDocument();

    await waitFor(() => { Fake.last!.handlers.onGroupRead!(GID, 1); });
    await waitFor(() => expect(msgs().querySelectorAll(".ck.read").length).toBe(1));

    await waitFor(() => { Fake.last!.handlers.onGroupRead!(GID, 0); }); // 迟到的旧值
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs().querySelectorAll(".ck.read").length).toBe(1);

    await waitFor(() => { Fake.last!.handlers.onGroupRead!(GID, 2); });
    await waitFor(() => expect(msgs().querySelectorAll(".ck.read").length).toBe(2));
  });

  it("别的群的 group_read 不影响当前群", async () => {
    await enterChat();
    await waitFor(() => { Fake.last!.handlers.onMessage!(mine(1)); });
    await waitFor(() => expect(msgs().querySelectorAll(".ck").length).toBe(1));
    await waitFor(() => { Fake.last!.handlers.onGroupRead!("g_other", 99); });
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs().querySelector(".ck.read")).not.toBeInTheDocument();
  });
});
