import { describe, it, expect, beforeEach } from "vitest";
import { saveMessage, loadConversation, saveConversations, loadConversations } from "./localStore";
import type { ChatMessage, Conversation } from "./protocol";

const msg = (convId: string, seq: number, from: string, content = "x"): ChatMessage => ({
  convId, from, content, contentType: "text", convSeq: seq, timestamp: 1000 + seq, status: "received",
});

// 各用例用不同 owner，避免共享 IndexedDB 实例下的串扰（localStore 缓存连接，不便重置）。
describe("localStore 消息（IndexedDB）", () => {
  it("保存后按 conv_seq 升序载回", async () => {
    await saveMessage("o1", msg("c1", 2, "a"));
    await saveMessage("o1", msg("c1", 1, "a"));
    await saveMessage("o1", msg("c1", 3, "b"));
    const got = await loadConversation("o1", "c1");
    expect(got.map((m) => m.convSeq)).toEqual([1, 2, 3]);
    expect(got[2].from).toBe("b");
  });

  it("同一 (owner,conv,seq) 幂等覆盖，不重复", async () => {
    await saveMessage("o2", msg("c1", 1, "a", "first"));
    await saveMessage("o2", msg("c1", 1, "a", "second"));
    const got = await loadConversation("o2", "c1");
    expect(got.length).toBe(1);
    expect(got[0].content).toBe("second");
  });

  it("convSeq<=0（发送中/失败）不入库", async () => {
    await saveMessage("o3", msg("c1", 0, "a"));
    expect((await loadConversation("o3", "c1")).length).toBe(0);
  });

  it("按 owner 隔离，互不可见", async () => {
    await saveMessage("oA", msg("c1", 1, "a"));
    expect((await loadConversation("oB", "c1")).length).toBe(0);
  });

  it("空 owner/convId 安全返回空", async () => {
    await saveMessage("", msg("c1", 1, "a"));
    expect(await loadConversation("", "c1")).toEqual([]);
    expect(await loadConversation("ox", "")).toEqual([]);
  });
});

describe("localStore 会话列表缓存（localStorage）", () => {
  beforeEach(() => localStorage.clear());
  const conv = (peer: string): Conversation => ({
    conv_id: `u_${peer}`, peer, last_message: null, latest_conv_seq: 1, unread: 0, read_seq: 0, peer_read_seq: 0,
  });

  it("写入后能原样读回", () => {
    saveConversations("o1", [conv("p2"), conv("p3")]);
    expect(loadConversations("o1").map((c) => c.peer)).toEqual(["p2", "p3"]);
  });

  it("按 owner 隔离", () => {
    saveConversations("o1", [conv("p2")]);
    expect(loadConversations("o9")).toEqual([]);
  });

  it("无缓存返回空数组", () => {
    expect(loadConversations("never")).toEqual([]);
  });
});
