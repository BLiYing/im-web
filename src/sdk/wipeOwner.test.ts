import { describe, expect, it, vi } from "vitest";
import { loadConversation, saveConversations, loadConversations, saveMessage, advanceSyncCursor, loadSyncCursor } from "./localStore";
import { wipeOwnerLocalData } from "./wipeOwner";
import type { ChatMessage, Conversation } from "./protocol";

const msg = (seq: number): ChatMessage => ({ convId: "c1", from: "a", content: "x", contentType: "text", convSeq: seq, timestamp: 1000 + seq, status: "received" });

describe("wipeOwnerLocalData", () => {
  it("只清该 owner 的消息/游标/会话缓存，别的账号不动", async () => {
    await saveMessage("wipeA", msg(1)); await saveMessage("wipeB", msg(1));
    await advanceSyncCursor("wipeA", "c1", 1); await advanceSyncCursor("wipeB", "c1", 1);
    localStorage.setItem("im.optedIn.wipeA", "[]"); localStorage.setItem("im.voice.played.wipeA.c1", "[]"); localStorage.setItem("im.optedIn.wipeB", "[]");
    saveConversations("wipeA", [{ conv_id: "c1" } as Conversation]); saveConversations("wipeB", [{ conv_id: "c1" } as Conversation]);
    await wipeOwnerLocalData("wipeA");
    expect(await loadConversation("wipeA", "c1")).toHaveLength(0);
    expect(await loadSyncCursor("wipeA", "c1")).toBe(0);
    expect(loadConversations("wipeA")).toHaveLength(0);
    expect(await loadConversation("wipeB", "c1")).toHaveLength(1);
    expect(await loadSyncCursor("wipeB", "c1")).toBe(1);
    expect(loadConversations("wipeB")).toHaveLength(1);
    expect(localStorage.getItem("im.optedIn.wipeA")).toBeNull();
    expect(localStorage.getItem("im.voice.played.wipeA.c1")).toBeNull();
    expect(localStorage.getItem("im.optedIn.wipeB")).not.toBeNull();
  });
  it("owner 前缀相同的账号不被误伤（wipeA vs wipeAB）", async () => {
    await saveMessage("wipeA2", msg(1)); await saveMessage("wipeA2B", msg(1));
    localStorage.setItem("im.optedIn.wipeA2B", "[]");
    await wipeOwnerLocalData("wipeA2");
    expect(await loadConversation("wipeA2B", "c1")).toHaveLength(1);
    expect(localStorage.getItem("im.optedIn.wipeA2B")).not.toBeNull();
  });
  it("补扫时同 uid 已重新登录则不再清", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] }); // 只假 setTimeout：fake-indexeddb 靠 setImmediate 推进
    try {
      await wipeOwnerLocalData("wipeR");
      localStorage.setItem("im.session", JSON.stringify({ uid: "wipeR", refresh: "r" }));
      localStorage.setItem("im.optedIn.wipeR", "[]");
      await vi.advanceTimersByTimeAsync(2000);
      expect(localStorage.getItem("im.optedIn.wipeR")).not.toBeNull();
    } finally { vi.useRealTimers(); localStorage.removeItem("im.session"); }
  });
  it("空 owner 直接返回", async () => { await expect(wipeOwnerLocalData("")).resolves.toBeUndefined(); });
});
