/**
 * 本机清空位点 `clearedUpTo` 的 **SDK 层**行为（OFFLINE_BACKLOG_DESIGN §6.7）。
 *
 * 存储语义由 localStore.contract*.ts 钉，取数分流的纯函数由 windowPlan.test.ts 钉；这里钉**调用点**：
 * 白盒驱动真实的 IMClient（连 fake-indexeddb 一起跑）、数出站帧、断言落盘与上屏——
 * 纯函数测试照不到「分流函数拿没拿到 floor」「落库侧过滤了、内存侧没过滤」这类接线错误。
 *
 * 现场（2026-10-02 Web 实测）：清空「1001创建测试群」→ 切走再切回 → 历史整页重新出现。
 */
import { describe, it, expect, vi } from "vitest";
import { IMClient } from "./imSdk";
import type { ChatMessage } from "./protocol";
import { clearMessages, loadClearedUpTo, loadConversation, loadSyncCursor, saveIncomingPage } from "./localStore";

const CID = "g_clear";
const settle = () => new Promise((r) => setTimeout(r, 20));

const row = (seq: number, over: Record<string, unknown> = {}) => ({
  server_msg_id: `s${seq}`, conv_id: CID, from: "peer", content: `#${seq}`,
  content_type: "text", conv_seq: seq, timestamp: 1_700_000_000_000 + seq, ...over,
});
const msg = (seq: number): ChatMessage => ({
  convId: CID, from: "peer", content: `#${seq}`, contentType: "text", convSeq: seq, timestamp: 1_700_000_000_000 + seq, status: "received",
});

function setup(owner: string) {
  const onMessage = vi.fn();
  const onHistoryPage = vi.fn();
  const client = new IMClient({ onMessage, onHistoryPage });
  (client as unknown as { uid: string }).uid = owner;
  const sent: { type?: string; data?: Record<string, unknown> }[] = [];
  (client as unknown as { ws: unknown }).ws = { readyState: WebSocket.OPEN, send: (s: string) => { sent.push(JSON.parse(s)); } };
  const feed = (f: unknown) => (client as unknown as { onFrame(raw: string): void }).onFrame(JSON.stringify(f));
  const windowReqs = () => sent.filter((f) => f.type === "window_req");
  const seqsDelivered = () => onMessage.mock.calls.map((c) => (c[0] as ChatMessage).convSeq);
  return { client, sent, feed, windowReqs, onMessage, onHistoryPage, seqsDelivered };
}

/** 一个已同步到 30、本地齐全的会话，然后清空它。返回客户端。 */
async function clearedAt30(owner: string) {
  const t = setup(owner);
  const all = Array.from({ length: 30 }, (_, i) => msg(i + 1));
  await saveIncomingPage(owner, all, 30, 1, 30, 30);
  t.client.trackConversation(CID, 30, false);
  await t.client.clearConversation(CID, 30);
  t.sent.length = 0;
  return t;
}

describe("清空之后进会话", () => {
  it("切走再切回：不发 window_req，也不再拉回任何一条（修复前整页拉回）", async () => {
    const t = await clearedAt30("o-cf-enter");
    expect(t.client.visibleFloorOf(CID)).toBe(30);
    expect(await loadConversation("o-cf-enter", CID)).toEqual([]);

    t.client.openConversation(CID, 30, 30, 0, 0);   // 无未读 → 取最新
    await settle();

    expect(t.windowReqs()).toEqual([]);
    expect(t.onHistoryPage).toHaveBeenCalled();     // 走的是本地分支：仍要报「取数结束」解除忙标志
  });

  it("读位点还停在被清掉的那段里、服务端仍报未读：不会把被清掉的整页要回来", async () => {
    const t = await clearedAt30("o-cf-unread");
    t.client.openConversation(CID, 5, 30, 25, 0);   // read_seq=5、unread=25：锚点本应是 5
    await settle();
    expect(t.windowReqs()).toEqual([]);             // tip(30) <= floor(30)：可见范围内没有东西
  });

  it("位点之后来了新消息：照常收、照常落库；位点以内的（含实时帧）既不上屏也不落库", async () => {
    const t = await clearedAt30("o-cf-live");
    t.feed({ type: "new_msg", data: row(29) });   // 位点以内：服务端重推 / 补拉带回
    t.feed({ type: "new_msg", data: row(31) });
    await settle();
    expect(t.seqsDelivered()).toEqual([31]);
    expect((await loadConversation("o-cf-live", CID)).map((m) => m.convSeq)).toEqual([31]);
  });

  it("sync 页 / window 页里位点以内的消息被丢，位点之后的留；区间照旧登记", async () => {
    const t = await clearedAt30("o-cf-pages");
    // 位点之上先有两个占号行（31、32，如 msg_op 事件行）再是真消息——页首不贴着游标，这样 sync 页走整页落库那条路。
    t.feed({ type: "sync_resp", data: { conversations: [{
      conv_id: CID, messages: [row(28), row(29), row(30), row(33), row(34)], covered_conv_seq: 34, has_more: false, head_conv_seq: 34,
    }] } });
    t.feed({ type: "window_resp", data: { conv_id: CID, anchor: 0, anchor_found: true, has_before: true, has_after: false,
      messages: [row(26), row(27), row(35)] } });
    await settle();
    expect(t.seqsDelivered().sort((a, b) => a - b)).toEqual([33, 34, 35]);
    expect((await loadConversation("o-cf-pages", CID)).map((m) => m.convSeq)).toEqual([33, 34, 35]);
    expect(await loadSyncCursor("o-cf-pages", CID)).toBe(34);
  });

  it("新消息进来之后再进会话：只要求清单覆盖位点之上那几条，照样不拉回被清掉的", async () => {
    const t = await clearedAt30("o-cf-after");
    t.feed({ type: "new_msg", data: row(31) });
    t.feed({ type: "new_msg", data: row(32) });
    await settle();
    t.sent.length = 0;
    t.client.openConversation(CID, 30, 32, 2, 32);
    await settle();
    expect(t.windowReqs()).toEqual([]);
  });
});

describe("上滚到位点", () => {
  it("最早一条踩在位点的下一条上：到顶，不再发请求；位点之上照常问", async () => {
    const t = await clearedAt30("o-cf-scroll");
    t.feed({ type: "new_msg", data: row(31) });
    await settle();
    t.sent.length = 0;

    expect(t.client.atHistoryFloor(CID, 31)).toBe(true);
    t.client.loadOlder(CID, 31);
    expect(t.windowReqs()).toEqual([]);

    // 反面：位点之上还有空间时照常问，证明上面那条不是「loadOlder 根本不发」蒙来的。
    expect(t.client.atHistoryFloor(CID, 36)).toBe(false);
    t.client.loadOlder(CID, 36);
    expect(t.windowReqs()).toHaveLength(1);
  });

  it("有效下界取大：服务端下界（has_before=false）比位点高时以服务端的为准，位点不会把它压低", async () => {
    const t = await clearedAt30("o-cf-max");
    t.feed({ type: "window_resp", data: { conv_id: CID, anchor: 0, anchor_found: true, has_before: false, has_after: false,
      messages: [row(40), row(41)] } });
    await settle();
    expect(t.client.visibleFloorOf(CID)).toBe(39);      // max(40-1, 30)
    expect(t.client.atHistoryFloor(CID, 40)).toBe(true);
    expect(t.client.atHistoryFloor(CID, 41)).toBe(false);
  });
});

describe("位点是纯本机状态：重登 / 刷新会话列表都不能把它重置", () => {
  it("重新登录（新 client、从存储读回位点交给 trackConversation）后仍然挡得住", async () => {
    await clearedAt30("o-cf-relogin");
    const t = setup("o-cf-relogin");   // 新进程：内存镜像全空
    const cleared = await loadClearedUpTo("o-cf-relogin", CID);
    expect(cleared).toBe(30);
    t.client.trackConversation(CID, await loadSyncCursor("o-cf-relogin", CID), false, cleared);
    t.feed({ type: "sync_resp", data: { conversations: [{ conv_id: CID, messages: [row(29), row(32)], covered_conv_seq: 32, has_more: false, head_conv_seq: 32 }] } });
    await settle();
    expect(t.seqsDelivered()).toEqual([32]);
    t.client.openConversation(CID, 32, 32, 0, 32);
    await settle();
    expect(t.windowReqs()).toEqual([]);
  });

  it("会话刷新里重复登记同一会话（preloadNew 传 0 游标 / 0 位点）不会把位点清零", async () => {
    const t = await clearedAt30("o-cf-refresh");
    t.client.trackConversation(CID, 0, true);   // 刷新：超级群标记变了，其余参数取默认
    t.client.trackConversation(CID, 0, false);
    expect(t.client.visibleFloorOf(CID)).toBe(30);
    expect(t.client.clearedUpToOf(CID)).toBe(30);
  });

  it("再次清空只增不减：更小的 knownLatest 不会把位点拉回去", async () => {
    const t = await clearedAt30("o-cf-mono");
    await t.client.clearConversation(CID, 5);
    expect(t.client.clearedUpToOf(CID)).toBe(30);
    expect(await loadClearedUpTo("o-cf-mono", CID)).toBe(30);
  });
});

describe("清空动作本身", () => {
  it("内存里的区间镜像一并清掉并通知 UI 重算切段（否则渲染层还认为这几段本地齐全）", async () => {
    const onRanges = vi.fn();
    const t = setup("o-cf-mirror");
    (t.client as unknown as { handlers: { onRanges: typeof onRanges } }).handlers.onRanges = onRanges;
    t.feed({ type: "window_resp", data: { conv_id: CID, anchor: 0, anchor_found: true, has_before: true, has_after: false, messages: [row(1), row(2), row(3)] } });
    await settle();
    expect(t.client.rangesOf(CID)).toEqual([{ lo: 1, hi: 3 }]);
    onRanges.mockClear();
    await t.client.clearConversation(CID, 3);
    expect(t.client.rangesOf(CID)).toEqual([]);
    expect(onRanges).toHaveBeenCalledWith(CID);
  });

  it("清空把游标推到位点；没清过的会话位点是 0", async () => {
    await clearedAt30("o-cf-cursor");
    expect(await loadSyncCursor("o-cf-cursor", CID)).toBe(30);
    const t = setup("o-cf-never");
    expect(t.client.visibleFloorOf(CID)).toBe(0);
    await clearMessages("o-cf-never", "other", 0);
    expect(await loadClearedUpTo("o-cf-never", "other")).toBe(0);
  });
});

describe("清空进行中到达的补拉页", () => {
  it("存储往返期间 sync_resp 带来的位点以内消息：不上屏（内存位点要先于存储往返抬高）", async () => {
    const owner = "o-cf-inflight";
    const t = setup(owner);
    await saveIncomingPage(owner, Array.from({ length: 30 }, (_, i) => msg(i + 1)), 30, 1, 30, 30);
    t.client.trackConversation(CID, 30, false);

    const p = t.client.clearConversation(CID, 30);   // 不 await：此刻存储清空还在路上
    t.feed({ type: "sync_resp", seq: 1, data: { conversations: [{
      conv_id: CID, messages: [row(29), row(30)], covered_conv_seq: 30, has_more: false,
    }] } });
    await p;
    await settle();

    expect(t.seqsDelivered()).toEqual([]);
  });
});
