/**
 * 「删除会话」＝ 清除到位点（OFFLINE_BACKLOG_DESIGN §6.7.1）的 SDK 接线：三个触发点各钉一条。
 * 白盒驱动真实 IMClient + fake-indexeddb（同 clearFloorSdk.test.ts 的做法）。
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { IMClient } from "./imSdk";
import type { ChatMessage } from "./protocol";
import { loadClearedUpTo, loadConversation, saveIncomingPage } from "./localStore";

const CID = "g_del";
const msg = (seq: number): ChatMessage => ({
  convId: CID, from: "peer", content: `#${seq}`, contentType: "text", convSeq: seq, timestamp: 1_700_000_000_000 + seq, status: "received",
});
const env = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

async function setup(owner: string, upTo = 30) {
  const onConvCleared = vi.fn();
  const client = new IMClient({ onConvCleared });
  (client as unknown as { uid: string }).uid = owner;
  (client as unknown as { token: string }).token = "tok";
  await saveIncomingPage(owner, Array.from({ length: upTo }, (_, i) => msg(i + 1)), upTo, 1, upTo, upTo);
  client.trackConversation(CID, upTo, false);
  const feed = (f: unknown) => (client as unknown as { onFrame(raw: string): void }).onFrame(JSON.stringify(f));
  return { client, onConvCleared, feed };
}
async function saveClearedElsewhere(owner: string, at: number): Promise<void> {
  const other = new IMClient({});
  (other as unknown as { uid: string }).uid = owner;
  await other.clearConversation(CID, at, true);
}
const settle = () => new Promise((r) => setTimeout(r, 200));

describe("触发点① 本机删除会话成功", () => {
  it("DELETE 回包的 cleared_at 当位点；位点之后本地已有的消息保留；通知 UI 清内存", async () => {
    const t = await setup("o-del-1");
    vi.stubGlobal("fetch", vi.fn(async () => env({ code: 0, data: { cleared_at: 20 } })));
    await t.client.deleteConversation(CID);
    expect(await loadClearedUpTo("o-del-1", CID)).toBe(20);
    expect((await loadConversation("o-del-1", CID)).map((m) => m.convSeq)).toEqual(Array.from({ length: 10 }, (_, i) => 21 + i));
    expect(t.onConvCleared).toHaveBeenCalledWith(CID, 20, true, { source: "local", retained: true });
  });
  it("回包没有 cleared_at（老服务端）：退回本机 head，整段清掉", async () => {
    const t = await setup("o-del-2");
    vi.stubGlobal("fetch", vi.fn(async () => env({ code: 0 })));
    await t.client.deleteConversation(CID);
    expect(await loadClearedUpTo("o-del-2", CID)).toBe(30);
    expect(await loadConversation("o-del-2", CID)).toEqual([]);
  });
  it("服务端失败：本机什么都不清", async () => {
    const t = await setup("o-del-3");
    vi.stubGlobal("fetch", vi.fn(async () => env({ code: 500001, message: "boom" })));
    await expect(t.client.deleteConversation(CID)).rejects.toThrow();
    expect(await loadClearedUpTo("o-del-3", CID)).toBe(0);
    expect(await loadConversation("o-del-3", CID)).toHaveLength(30);
  });
  it("丢掉服务端下界缓存：删除后不再被旧 floorSeq 干扰", async () => {
    const t = await setup("o-del-4");
    (t.client as unknown as { floorSeq: Map<string, number> }).floorSeq.set(CID, 5);
    vi.stubGlobal("fetch", vi.fn(async () => env({ code: 0, data: { cleared_at: 20 } })));
    await t.client.deleteConversation(CID);
    expect((t.client as unknown as { floorSeq: Map<string, number> }).floorSeq.has(CID)).toBe(false);
    expect(t.client.visibleFloorOf(CID)).toBe(20);
  });
});

describe("触发点② conv_update action=delete（别的设备删的）", () => {
  it("按帧里的 cleared_at 清到位点", async () => {
    const t = await setup("o-del-5");
    t.feed({ type: "conv_update", data: { conv_id: CID, action: "delete", cleared_at: 25 } });
    await settle();
    expect(await loadClearedUpTo("o-del-5", CID)).toBe(25);
    expect((await loadConversation("o-del-5", CID)).map((m) => m.convSeq)).toEqual([26, 27, 28, 29, 30]);
    expect(t.onConvCleared).toHaveBeenCalledWith(CID, 25, true, { source: "frame", retained: true });
    expect(t.client.rangesOf(CID)).toEqual([{ lo: 26, hi: 30 }]);   // 内存区间镜像只留位点之后的，否则位点后真消息会被当成「没下载」
  });
  it("本机删除后又收到同一位点的回声帧：位点没推进 → advanced=false，不重复通知", async () => {
    const t = await setup("o-del-9");
    vi.stubGlobal("fetch", vi.fn(async () => env({ code: 0, data: { cleared_at: 20 } })));
    await t.client.deleteConversation(CID);
    t.feed({ type: "conv_update", data: { conv_id: CID, action: "delete", cleared_at: 20 } });
    await settle();
    expect(t.onConvCleared.mock.calls.map((c) => c[2])).toEqual([true, false]);
  });
  it("非 delete 动作（置顶等）不清", async () => {
    const t = await setup("o-del-6");
    t.feed({ type: "conv_update", data: { conv_id: CID, action: "pin", cleared_at: 25 } });
    await settle();
    expect(await loadClearedUpTo("o-del-6", CID)).toBe(0);
  });
});

describe("触发点② 真实流程缺口：位点已被别的标签页 / 先到的列表对齐写进共享存储", () => {
  it("存储里位点已是 25、本标签内存镜像还是 0：帧仍要报 advanced=true（UI 没清过）", async () => {
    const t = await setup("o-del-11");
    await saveClearedElsewhere("o-del-11", 25);
    t.feed({ type: "conv_update", data: { conv_id: CID, action: "delete", cleared_at: 25 } });
    await vi.waitFor(() => expect(t.onConvCleared).toHaveBeenCalled());
    expect(t.onConvCleared.mock.calls[0][2]).toBe(true);
  });
});

describe("触发点③ 会话列表 cleared_at", () => {
  const list = (items: unknown[]) => vi.fn(async () => env({ code: 0, data: { conversations: items } }));
  it("cleared_at 超过本机位点：清到 cleared_at；再拉一次（已对齐）不重复清", async () => {
    const t = await setup("o-del-7");
    vi.stubGlobal("fetch", list([{ conv_id: CID, peer: "p", cleared_at: 22 }]));
    await t.client.fetchConversations();
    expect(await loadClearedUpTo("o-del-7", CID)).toBe(22);
    expect((await loadConversation("o-del-7", CID)).map((m) => m.convSeq)[0]).toBe(23);
    await t.client.fetchConversations();
    expect(t.onConvCleared).toHaveBeenCalledTimes(1);
    expect(t.onConvCleared.mock.calls[0][3]).toEqual({ source: "align", retained: true });
  });
  it("帧：位点覆盖全部本地消息 → retained=false", async () => {
    const t = await setup("o-del-10");
    t.feed({ type: "conv_update", data: { conv_id: CID, action: "delete", cleared_at: 30 } });
    await vi.waitFor(() => expect(t.onConvCleared).toHaveBeenCalled());
    expect(t.onConvCleared.mock.calls[0][3]).toEqual({ source: "frame", retained: false });
  });
  it("cleared_at 不大于本机位点 / 没有该字段：不动本机消息", async () => {
    const t = await setup("o-del-8");
    await t.client.clearConversation(CID, 30);
    vi.stubGlobal("fetch", list([{ conv_id: CID, peer: "p", cleared_at: 10 }, { conv_id: "other", peer: "q" }]));
    await t.client.fetchConversations();
    expect(t.onConvCleared).not.toHaveBeenCalled();
    expect(await loadClearedUpTo("o-del-8", CID)).toBe(30);
  });
});
