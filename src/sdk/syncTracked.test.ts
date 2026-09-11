/**
 * 会话刷新只同步新冒出来的会话（2026-09-11）：App 的 useLocalPreload 靠 SDK 这两条契约才站得住——
 *   ① `syncTracked(给定)` 只带那几个会话的游标，不顺带全量；
 *   ② 对已登记会话再调 `trackConversation(id, 0, isSuper)` 只换超级群标记，**不盖掉**已登记的同步游标。
 * ② 错了是静默的：游标被 0 盖掉后下次 sync 从头要，普通会话积压超 max_gap 就被当成缺口，本地明明齐全。
 */
import { describe, it, expect } from "vitest";
import { IMClient } from "./imSdk";

type Cursor = { conv_id: string; since_conv_seq: number; max_gap: number };
type Sent = { type?: string; data?: { cursors?: Cursor[] } };

function clientWithSocket(owner: string): { client: IMClient; sent: Sent[] } {
  const client = new IMClient({});
  (client as unknown as { uid: string }).uid = owner;
  const sent: Sent[] = [];
  (client as unknown as { ws: unknown }).ws = {
    readyState: WebSocket.OPEN,
    send: (s: string) => { sent.push(JSON.parse(s) as Sent); },
  };
  return { client, sent };
}

const syncCursors = (sent: Sent[]) => sent.filter((f) => f.type === "sync_req").map((f) => f.data?.cursors);

describe("syncTracked 可只同步给定会话", () => {
  it("给了 convIds 只带这几个的游标；不给仍是全部已登记会话", () => {
    const { client, sent } = clientWithSocket("o-sync-subset");
    client.trackConversation("c_a", 57, false);
    client.trackConversation("c_b", 9, false);
    client.syncTracked(["c_b"]);
    expect(syncCursors(sent)).toEqual([[{ conv_id: "c_b", since_conv_seq: 9, max_gap: 400 }]]);
    sent.length = 0;
    client.syncTracked(); // c_b 还在途（没收到 sync_resp），被在途去重挡掉，只剩 c_a
    expect(syncCursors(sent)).toEqual([[{ conv_id: "c_a", since_conv_seq: 57, max_gap: 400 }]]);
  });
});

describe("trackConversation 对已登记会话", () => {
  it("传 0 当游标不盖掉原基线，但超级群标记跟着换（群刚升级）", () => {
    const { client, sent } = clientWithSocket("o-track-refresh");
    client.trackConversation("g_up", 57, false);
    client.trackConversation("g_up", 0, true);
    client.syncTracked(["g_up"]);
    expect(syncCursors(sent)).toEqual([[{ conv_id: "g_up", since_conv_seq: 57, max_gap: 0 }]]);
  });
});
