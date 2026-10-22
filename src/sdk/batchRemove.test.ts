/**
 * 批量本地移除（自动删除清理 / 批量删除共用）：整批墓碑一个 IndexedDB 事务、整批只通知一次。
 * 白盒：spy IDBDatabase.prototype.transaction 数事务（fake-indexeddb）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { removeBatchLocal } from "./batchRemove";
import { saveMessage, loadConversation, loadDeletedSeqs } from "./localStore";
import type { ChatMessage } from "./protocol";

const CID = "c_batch_rm";
const mk = (seq: number): ChatMessage => ({
  serverMsgId: `s${seq}`, clientMsgId: `c${seq}`, convId: CID, from: "peer", content: `#${seq}`, contentType: "text",
  convSeq: seq, timestamp: 1000 + seq, status: "sent",
} as ChatMessage);

afterEach(() => vi.restoreAllMocks());

describe("removeBatchLocal", () => {
  it("N 条只开 1 个事务、只通知 1 次（带全部 seq），消息删光且留墓碑", async () => {
    const owner = "o-batch-1";
    const seqs = Array.from({ length: 50 }, (_, i) => i + 1);
    for (const s of seqs) await saveMessage(owner, mk(s));
    const spy = vi.spyOn(IDBDatabase.prototype, "transaction");
    const onRemoved = vi.fn();
    await removeBatchLocal(owner, CID, seqs, onRemoved);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(onRemoved).toHaveBeenCalledTimes(1);
    expect(onRemoved).toHaveBeenCalledWith(CID, seqs);
    expect(await loadConversation(owner, CID)).toEqual([]);
    expect((await loadDeletedSeqs(owner, CID)).length).toBe(50);
  });

  it("空批：不开事务、不通知", async () => {
    const spy = vi.spyOn(IDBDatabase.prototype, "transaction");
    const onRemoved = vi.fn();
    await removeBatchLocal("o-batch-2", CID, [], onRemoved);
    expect(spy).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
  });
});
