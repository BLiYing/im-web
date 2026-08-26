// @vitest-environment jsdom
/**
 * 置顶横幅（G0）与「原消息已经没了」的收敛（用户实测 2026-08-26）：
 * 置顶一条 → 立刻撤回 → 横幅必须自己消失；来不及消失时点它必须**明确提示**，
 * 而不是静默滚到那条「撤回了一条消息」的系统行上闪一下（旧行为，用户看不出发生了什么）。
 *
 * 服务端口径见 IMServer/internal/store/sqlite_message.go PinnedMessages（recalled_at = 0 / deleted_at = 0）
 * 与 conversation/pinned.go（再排除 caller「仅为我删除」）——客户端只需在撤回帧到达时重拉一次。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChatMessage, PinnedMessage } from "./sdk/protocol";

vi.mock("./sdk/imSdk", async () => ({ IMClient: (await import("./testing/fakeIMClient")).FakeIMClient, registerAccount: vi.fn(async () => {}) }));

import { IMClient } from "./sdk/imSdk";

import type { Fake } from "./testing/fakeIMClient";
import { PEER, CID, makeConv as conv, installJsdomShims, enterChat } from "./testing/appHarness";
const Fake = IMClient as unknown as Fake;

const SEQ = 7; // 被置顶又被撤回的那条

const pin = (convSeq = SEQ): PinnedMessage => ({
  convSeq, serverMsgId: `s${convSeq}`, from: PEER, contentType: "text",
  content: "周五下午三点开会", timestamp: Date.now(), pinnedAt: Date.now(),
});

const msg = (convSeq = SEQ): ChatMessage => ({
  convId: CID, from: PEER, content: "周五下午三点开会", contentType: "text",
  convSeq, timestamp: Date.now(), status: "sent",
} as ChatMessage);

beforeEach(() => {
  localStorage.clear();
  Fake.conversations = [conv()];
  Fake.pinned = [];
  installJsdomShims();
});
afterEach(() => { cleanup(); Fake.pinned = []; vi.restoreAllMocks(); });

/** 免密登录 → 进单聊 → 等置顶横幅上屏（Fake.pinned 已预置）。 */
async function enterChatWithPinned() {
  Fake.pinned = [pin()];
  await enterChat();
  await waitFor(() => expect(document.querySelector(".pin-banner")).toBeInTheDocument());
  await waitFor(() => { Fake.last!.handlers.onMessage!(msg()); });
  // 横幅与气泡显同一段文字 → 两处都在（用 getAllByText，findByText 会因命中多个而抛）。
  await waitFor(() => expect(screen.getAllByText("周五下午三点开会").length).toBe(2));
}

describe("置顶横幅：原消息被撤回后的收敛", () => {
  it("置顶消息被撤回 → 重拉置顶集合，横幅自动消失", async () => {
    await enterChatWithPinned();
    Fake.pinned = []; // 服务端置顶列表已剔除撤回消息
    await waitFor(() => { Fake.last!.handlers.onMsgOp!(CID, SEQ, { recalledAt: Date.now() }); });
    await waitFor(() => expect(document.querySelector(".pin-banner")).not.toBeInTheDocument());
  });

  it("置顶消息被编辑 → 同样重拉，横幅显新文案（不留旧文案）", async () => {
    await enterChatWithPinned();
    Fake.pinned = [{ ...pin(), content: "改到周六上午十点" }];
    await waitFor(() => { Fake.last!.handlers.onMsgOp!(CID, SEQ, { editedAt: Date.now(), content: "改到周六上午十点" }); });
    await waitFor(() => expect(document.querySelector(".pin-banner-text")!.textContent).toBe("改到周六上午十点"));
  });

  it("非置顶消息被撤回 → 不做多余重拉（横幅照旧）", async () => {
    await enterChatWithPinned();
    const before = (Fake.last!.calls["fetchPinned"] ?? []).length;
    await waitFor(() => { Fake.last!.handlers.onMsgOp!(CID, SEQ + 1, { recalledAt: Date.now() }); });
    expect((Fake.last!.calls["fetchPinned"] ?? []).length).toBe(before);
    expect(document.querySelector(".pin-banner")).toBeInTheDocument();
  });

  it("横幅尚未收敛（重拉失败/帧未到）时点它 → 提示「原消息已被撤回」，不静默滚到墓碑", async () => {
    await enterChatWithPinned();
    // 服务端置顶列表仍返回这条（模拟重拉失败/在飞）——横幅留在旧集合上。
    await waitFor(() => { Fake.last!.handlers.onMsgOp!(CID, SEQ, { recalledAt: Date.now() }); });
    await screen.findByText("对方撤回了一条消息");
    expect(document.querySelector(".pin-banner")).toBeInTheDocument();
    fireEvent.click(document.querySelector(".pin-banner-main")!);
    expect(await screen.findByText("原消息已被撤回")).toHaveClass("toast");
  });
});
