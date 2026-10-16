import { describe, expect, it } from "vitest";
import { loadConversation, saveConversations, loadConversations, saveMessage, advanceSyncCursor, loadSyncCursor } from "./localStore";
import { wipeOwnerLocalData } from "./wipeOwner";
import type { ChatMessage, Conversation } from "./protocol";

const msg = (seq: number): ChatMessage => ({ convId: "c1", from: "a", content: "x", contentType: "text", convSeq: seq, timestamp: 1000 + seq, status: "received" });

describe("wipeOwnerLocalData", () => {
  it("只清该 owner 的消息/游标/会话缓存，别的账号不动", async () => {
    await saveMessage("wipeA", msg(1)); await saveMessage("wipeB", msg(1));
    await advanceSyncCursor("wipeA", "c1", 1); await advanceSyncCursor("wipeB", "c1", 1);
    saveConversations("wipeA", [{ conv_id: "c1" } as Conversation]); saveConversations("wipeB", [{ conv_id: "c1" } as Conversation]);
    await wipeOwnerLocalData("wipeA");
    expect(await loadConversation("wipeA", "c1")).toHaveLength(0);
    expect(await loadSyncCursor("wipeA", "c1")).toBe(0);
    expect(loadConversations("wipeA")).toHaveLength(0);
    expect(await loadConversation("wipeB", "c1")).toHaveLength(1);
    expect(await loadSyncCursor("wipeB", "c1")).toBe(1);
    expect(loadConversations("wipeB")).toHaveLength(1);
  });
  it("空 owner 直接返回", async () => { await expect(wipeOwnerLocalData("")).resolves.toBeUndefined(); });
});
