/**
 * 「清除所有对话」的 SDK 批量清除（CLEAR_ALL_CONVERSATIONS_DESIGN §4；复用 §6.7.1 清除到位点）。
 * 白盒驱动真实 IMClient + fake-indexeddb（同 convDeleteClear.test.ts）。
 */
import { describe, it, expect, vi } from "vitest";
import { IMClient } from "./imSdk";
import type { ChatMessage } from "./protocol";
import { loadClearedUpTo, loadConversation, saveConversations, saveIncomingPage, saveRejected, loadConversations } from "./localStore";

const msg = (cid: string, seq: number): ChatMessage => ({
  convId: cid, from: "peer", content: `#${seq}`, contentType: "text", convSeq: seq, timestamp: 1_700_000_000_000 + seq, status: "received",
});
const seqs = async (o: string, cid: string) => (await loadConversation(o, cid)).map((m) => m.convSeq);
const settle = () => new Promise((r) => setTimeout(r, 200));

async function setup(owner: string) {
  const onConvCleared = vi.fn();
  const client = new IMClient({ onConvCleared });
  (client as unknown as { uid: string }).uid = owner;
  for (const [cid, n] of [["c_a", 30], ["c_b", 10]] as const) {
    await saveIncomingPage(owner, Array.from({ length: n }, (_, i) => msg(cid, i + 1)), n, 1, n, n);
    client.trackConversation(cid, n, false);
  }
  const feed = (f: unknown) => (client as unknown as { onFrame(raw: string): void }).onFrame(JSON.stringify(f));
  return { client, onConvCleared, feed };
}

describe("clearAllToFloors（批量清除到位点）", () => {
  it("每个会话只清 <= 各自 cleared_at 的行；其后的新消息保留；位点落库；通知 UI（source=align, batch）", async () => {
    const t = await setup("o-all-1");
    await t.client.clearAllToFloors([{ convId: "c_a", clearedAt: 20 }, { convId: "c_b", clearedAt: 10 }]);
    expect(await seqs("o-all-1", "c_a")).toEqual(Array.from({ length: 10 }, (_, i) => 21 + i));
    expect(await seqs("o-all-1", "c_b")).toEqual([]);
    expect([await loadClearedUpTo("o-all-1", "c_a"), await loadClearedUpTo("o-all-1", "c_b")]).toEqual([20, 10]);
    expect(t.onConvCleared).toHaveBeenCalledWith("c_a", 20, true, { source: "align", retained: false, batch: true });
    expect(t.onConvCleared).toHaveBeenCalledWith("c_b", 10, true, { source: "align", retained: false, batch: true });
    expect(t.client.clearedUpToOf("c_a")).toBe(20);
    expect(t.client.rangesOf("c_a")).toEqual([{ lo: 21, hi: 30 }]);   // 内存区间镜像只留位点之后
  });

  it("待发送 / 被拒（convSeq=0）的行保留", async () => {
    const t = await setup("o-all-2");
    await saveRejected("o-all-2", { ...msg("c_a", 0), clientMsgId: "cm-1", status: "failed" });
    await t.client.clearAllToFloors([{ convId: "c_a", clearedAt: 30 }]);
    expect(await seqs("o-all-2", "c_a")).toEqual([0]);
  });

  it("位点在会话项（列表缓存）被删之后仍在：只增不减", async () => {
    const t = await setup("o-all-3");
    await t.client.clearAllToFloors([{ convId: "c_a", clearedAt: 20 }]);
    await saveConversations("o-all-3", []);   // 会话行被移除
    expect(await loadConversations("o-all-3")).toEqual([]);
    expect(await loadClearedUpTo("o-all-3", "c_a")).toBe(20);
    await t.client.clearAllToFloors([{ convId: "c_a", clearedAt: 5 }]);   // 迟到的小位点不回退
    expect(await loadClearedUpTo("o-all-3", "c_a")).toBe(20);
  });

  it("随后到达的 conv_update(delete) 回声幂等：位点不变、advanced=false（UI 不重复清）、存储不变", async () => {
    const t = await setup("o-all-4");
    await t.client.clearAllToFloors([{ convId: "c_a", clearedAt: 20 }]);
    t.onConvCleared.mockClear();
    t.feed({ type: "conv_update", data: { conv_id: "c_a", action: "delete", cleared_at: 20 } });
    await settle();
    expect(await loadClearedUpTo("o-all-4", "c_a")).toBe(20);
    expect(await seqs("o-all-4", "c_a")).toHaveLength(10);
    expect(t.onConvCleared).toHaveBeenCalledWith("c_a", 20, false, expect.objectContaining({ source: "frame" }));
  });

  it("空列表 / 位点<=0 的项为空操作", async () => {
    const t = await setup("o-all-5");
    await t.client.clearAllToFloors([]);
    await t.client.clearAllToFloors([{ convId: "c_a", clearedAt: 0 }]);
    expect(await seqs("o-all-5", "c_a")).toHaveLength(30);
    expect(t.onConvCleared).not.toHaveBeenCalled();
  });
});
