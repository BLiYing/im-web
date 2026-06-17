import { describe, it, expect, beforeEach } from "vitest";
import { saveMessage, saveRejected, loadConversation, saveConversations, loadConversations } from "./localStore";
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

  it("保留真实 server_msg_id（举报消息按它定位，不能用复合键）", async () => {
    await saveMessage("oSid", { serverMsgId: "snow-123", convId: "c1", from: "a", content: "x", contentType: "text", convSeq: 1, timestamp: 1001, status: "received" });
    const got = await loadConversation("oSid", "c1");
    expect(got[0].serverMsgId).toBe("snow-123"); // 真实 id，而非 owner|c1|1 复合键
  });

  it("旧记录无 server_msg_id 时回退复合键（兼容）", async () => {
    // 直接用不带 serverMsgId 的消息（模拟旧库），载回时 serverMsgId 回退为复合键、不为空。
    await saveMessage("oOld", msg("c1", 2, "a"));
    const got = await loadConversation("oOld", "c1");
    expect(got[0].serverMsgId).toBe("oOld|c1|2");
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

  it("被拒收消息（convSeq=0）按 clientMsgId 落库，还原失败态+系统提示", async () => {
    await saveRejected("oR", {
      clientMsgId: "cm-1", convId: "c1", from: "oR", content: "hi", contentType: "text",
      convSeq: 0, timestamp: 5000, status: "failed", note: "消息已发出，但被对方拒收了",
    });
    const got = await loadConversation("oR", "c1");
    expect(got.length).toBe(1);
    expect(got[0].status).toBe("failed");
    expect(got[0].convSeq).toBe(0);
    expect(got[0].note).toBe("消息已发出，但被对方拒收了");
    expect(got[0].clientMsgId).toBe("cm-1");
  });

  it("多条被拒收消息按各自 clientMsgId 共存，不互相覆盖", async () => {
    const base = { convId: "c1", from: "oR2", content: "x", contentType: "text", convSeq: 0, timestamp: 1, status: "failed" as const, note: "n" };
    await saveRejected("oR2", { ...base, clientMsgId: "a" });
    await saveRejected("oR2", { ...base, clientMsgId: "b" });
    expect((await loadConversation("oR2", "c1")).length).toBe(2);
  });

  it("被拒收消息与已确认消息（convSeq>0）共存于同会话", async () => {
    await saveMessage("oR3", msg("c1", 1, "peer"));
    await saveRejected("oR3", {
      clientMsgId: "cm-9", convId: "c1", from: "oR3", content: "blocked", contentType: "text",
      convSeq: 0, timestamp: 2, status: "failed", note: "被拒收",
    });
    const got = await loadConversation("oR3", "c1");
    expect(got.length).toBe(2);
    expect(got.filter((m) => m.status === "failed").length).toBe(1);
    expect(got.filter((m) => m.convSeq > 0).length).toBe(1);
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
