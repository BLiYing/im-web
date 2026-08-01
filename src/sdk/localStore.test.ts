import { describe, it, expect, beforeEach } from "vitest";
import {
  saveMessage, saveRejected, applyMsgOpLocal, loadConversation,
  saveConversations, loadConversations, loadSyncCursor, advanceSyncCursor, saveIncomingMessage,
} from "./localStore";
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

  it("文件消息刷新后保留原始文件名和字节数", async () => {
    await saveMessage("oFile", {
      serverMsgId: "file-1", convId: "c1", from: "a", content: "/uploads/photo-uuid",
      contentType: "file", fileName: "photo.png", fileSize: 7340032, convSeq: 1, timestamp: 1001, status: "received",
    });
    const got = await loadConversation("oFile", "c1");
    expect(got[0].fileName).toBe("photo.png");
    expect(got[0].fileSize).toBe(7340032);
  });

  it("重复同步的稀疏文件元数据不会覆盖已确认的文件名和大小", async () => {
    await saveMessage("oFileMerge", {
      serverMsgId: "file-2", convId: "c1", from: "a", content: "/uploads/photo-uuid",
      contentType: "file", fileName: "photo.png", fileSize: 7340032, convSeq: 1, timestamp: 1001, status: "received",
    });
    await saveMessage("oFileMerge", {
      convId: "c1", from: "a", content: "/uploads/photo-uuid",
      contentType: "file", fileSize: 0, convSeq: 1, timestamp: 1001, status: "received",
    });
    const got = await loadConversation("oFileMerge", "c1");
    expect(got).toHaveLength(1);
    expect(got[0].fileName).toBe("photo.png");
    expect(got[0].fileSize).toBe(7340032);
    expect(got[0].serverMsgId).toBe("file-2");
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

  it("applyMsgOpLocal 撤回：就地置 recalledAt，载回带撤回态", async () => {
    await saveMessage("oOp", msg("c1", 1, "a", "secret"));
    await applyMsgOpLocal("oOp", "c1", 1, { recalledAt: 9999, recalledBy: "a" });
    const got = await loadConversation("oOp", "c1");
    expect(got[0].recalledAt).toBe(9999);
    expect(got[0].recalledBy).toBe("a");
  });

  it("applyMsgOpLocal 编辑：改 content + editedAt", async () => {
    await saveMessage("oOp2", msg("c1", 1, "a", "old"));
    await applyMsgOpLocal("oOp2", "c1", 1, { editedAt: 8888, content: "new" });
    const got = await loadConversation("oOp2", "c1");
    expect(got[0].content).toBe("new");
    expect(got[0].editedAt).toBe(8888);
  });

  it("applyMsgOpLocal 目标不存在时忽略（不新建行）", async () => {
    await applyMsgOpLocal("oOp3", "c1", 7, { recalledAt: 1 });
    expect((await loadConversation("oOp3", "c1")).length).toBe(0);
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

describe("localStore 连续同步游标（IndexedDB）", () => {
  it("无游标从 0 开始，不使用本地最大消息序号推断", async () => {
    await saveMessage("cursorA", msg("c1", 9, "peer"));
    expect(await loadSyncCursor("cursorA", "c1")).toBe(0);
  });

  it("按 owner 隔离且只能单调推进", async () => {
    await advanceSyncCursor("cursorA2", "c1", 5);
    await advanceSyncCursor("cursorA2", "c1", 3);
    expect(await loadSyncCursor("cursorA2", "c1")).toBe(5);
    expect(await loadSyncCursor("cursorB2", "c1")).toBe(0);
  });

  it("消息与连续游标同事务写入，非连续消息只落消息不越级", async () => {
    await saveIncomingMessage("cursorAtomic", msg("c1", 1, "peer"), true);
    await saveIncomingMessage("cursorAtomic", msg("c1", 3, "peer"), false);
    expect((await loadConversation("cursorAtomic", "c1")).map((m) => m.convSeq)).toEqual([1, 3]);
    expect(await loadSyncCursor("cursorAtomic", "c1")).toBe(1);
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
