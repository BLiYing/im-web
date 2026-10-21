/**
 * 自动删除：入库即过滤（AUTO_DELETE_DESIGN §3.2）。白盒驱动真实 onFrame（连 fake-indexeddb），
 * 断言「过期消息不上屏（不走 onMessage）、不进库」，未过期的照常；sync 整页同口径。
 */
import { describe, it, expect, vi } from "vitest";
import { IMClient } from "./imSdk";
import { loadConversation } from "./localStore";

const CID = "u_ad_a_u_ad_b";
const NOW = Date.now();
const DAY = 86_400_000;
const row = (seq: number, ts: number) => ({
  server_msg_id: `s${seq}`, conv_id: CID, from: "peer", content: `#${seq}`, content_type: "text", conv_seq: seq, timestamp: ts,
});
const settle = () => new Promise((r) => setTimeout(r, 30));

function setup(owner: string, sec: number) {
  const onMessage = vi.fn();
  const onMessageRemoved = vi.fn();
  const client = new IMClient({ onMessage, onMessageRemoved, isExpired: (_c, ts) => sec > 0 && ts + sec * 1000 <= Date.now() });
  (client as unknown as { uid: string }).uid = owner;
  const feed = (f: unknown) => (client as unknown as { onFrame(raw: string): void }).onFrame(JSON.stringify(f));
  return { client, feed, onMessage, onMessageRemoved };
}

describe("入库即过滤", () => {
  it("实时 new_msg：过期的不上屏不入库，未过期的照常", async () => {
    const { feed, onMessage } = setup("o-ad-1", 86400);
    feed({ type: "new_msg", data: row(1, NOW - 2 * DAY) });
    feed({ type: "new_msg", data: row(2, NOW - 1000) });
    await settle();
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].convSeq).toBe(2);
    const stored = await loadConversation("o-ad-1", CID);
    expect(stored.map((m) => m.convSeq)).toEqual([2]);
  });

  it("sync 整页：新设备首次同步 1 天档的老会话，旧消息不闪不落库", async () => {
    const { feed, onMessage } = setup("o-ad-2", 86400);
    feed({ type: "sync_resp", seq: 1, data: { conversations: [{
      conv_id: CID, covered_conv_seq: 3, has_more: false,
      messages: [row(1, NOW - 5 * DAY), row(2, NOW - 3 * DAY), row(3, NOW - 10)],
    }] } });
    await settle();
    expect(onMessage.mock.calls.map((c) => c[0].convSeq)).toEqual([3]);
    expect((await loadConversation("o-ad-2", CID)).map((m) => m.convSeq)).toEqual([3]);
  });

  it("档位关闭：不过滤", async () => {
    const { feed, onMessage } = setup("o-ad-3", 0);
    feed({ type: "new_msg", data: row(1, NOW - 90 * DAY) });
    await settle();
    expect(onMessage).toHaveBeenCalledTimes(1);
  });
});
