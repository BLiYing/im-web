/**
 * 连号 sync 页必须整页落库 + 登记区间 + 推游标 + 按 has_more 继续翻页（2026-10-02 修）。
 *
 * 现场：SYNC_RESP 里页起点 `before` 在逐条 processIncoming 之后才读；processIncoming 对紧挨游标的消息会逐条
 * updateSynced，一页连号消息把游标一路推到页尾，`next > before` 恒假——整页不落库、区间不登记、has_more 被忽略，
 * 只靠内存镜像 + 开窗/重拉掩盖，刷新后就没了。clearFloorSdk.test.ts 里那句「页首不贴着游标，这样 sync 页走整页落库那条路」
 * 就是绕着这个 bug 写的夹具。
 */
import { describe, it, expect, vi } from "vitest";
import { IMClient } from "./imSdk";
import { loadConversation, loadSyncCursor } from "./localStore";

const CID = "g_contig";
const settle = () => new Promise((r) => setTimeout(r, 30));
const row = (seq: number) => ({
  server_msg_id: `s${seq}`, conv_id: CID, from: "peer", content: `#${seq}`,
  content_type: "text", conv_seq: seq, timestamp: 1_700_000_000_000 + seq,
});

function setup(owner: string) {
  const client = new IMClient({ onMessage: vi.fn() });
  (client as unknown as { uid: string }).uid = owner;
  const sent: { type?: string; data?: { convs?: unknown } }[] = [];
  (client as unknown as { ws: unknown }).ws = { readyState: WebSocket.OPEN, send: (s: string) => { sent.push(JSON.parse(s)); } };
  const feed = (f: unknown) => (client as unknown as { onFrame(raw: string): void }).onFrame(JSON.stringify(f));
  return { client, sent, feed };
}

describe("连号 sync 页", () => {
  it("页首紧挨游标（从 0 起 1..5）：整页落库、游标推到页尾、has_more 继续翻页", async () => {
    const t = setup("o-contig");
    t.feed({ type: "sync_resp", data: { conversations: [{
      conv_id: CID, messages: [row(1), row(2), row(3), row(4), row(5)], covered_conv_seq: 5, has_more: true, head_conv_seq: 9,
    }] } });
    await settle();
    expect((await loadConversation("o-contig", CID)).map((m) => m.convSeq)).toEqual([1, 2, 3, 4, 5]); // 修复前：一条没落库
    expect(await loadSyncCursor("o-contig", CID)).toBe(5);
    expect(t.sent.filter((f) => f.type === "sync_req").length).toBeGreaterThan(0);                      // 修复前：has_more 被忽略
  });
});
