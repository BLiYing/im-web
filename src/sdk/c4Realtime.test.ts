/**
 * C4（OFFLINE_BACKLOG_DESIGN §4.8）：↓ 跳到底 / 实时跳号 / 超级群 conv_bump —— 在真实 onFrame 上数出站帧。
 *
 * 纯函数判据在 windowPlan.test.ts；这里钉的是**调用点**：实时消息有没有真的登记进区间清单（内存 + 落盘），
 * ↓ 与 bump 有没有真的按判据发 / 不发 window_req。这几处错了界面照常，只是要么白跑请求、
 * 要么该取的那一页永远不来——只看纯函数单测发现不了。
 */
import { describe, it, expect } from "vitest";
import { IMClient } from "./imSdk";
import { loadRanges } from "./localStore.ranges";

const CID = "g_c4";

type Sent = { type?: string; data?: { conv_id?: string; anchor?: number; before?: number; after?: number } };

/** 造一台已知 uid、挂假 socket 的客户端，好数出站帧（同 windowRange.test.ts 的做法）。 */
function clientWithSocket(owner: string): { client: IMClient; sent: Sent[]; feed: (frame: unknown) => void } {
  const client = new IMClient({});
  (client as unknown as { uid: string }).uid = owner;
  const sent: Sent[] = [];
  (client as unknown as { ws: unknown }).ws = {
    readyState: WebSocket.OPEN,
    send: (s: string) => { sent.push(JSON.parse(s) as Sent); },
  };
  const feed = (f: unknown) => (client as unknown as { onFrame(raw: string): void }).onFrame(JSON.stringify(f));
  return { client, sent, feed };
}

const row = (seq: number) => ({
  server_msg_id: `s${seq}`, conv_id: CID, from: "peer", content: `#${seq}`,
  content_type: "text", conv_seq: seq, timestamp: 1_700_000_000_000 + seq,
});
const windowResp = (lo: number, hi: number) => ({
  type: "window_resp",
  data: { conv_id: CID, anchor: 0, anchor_found: true, has_before: true, has_after: false,
    messages: Array.from({ length: hi - lo + 1 }, (_, i) => row(lo + i)) },
});
const newMsg = (seq: number) => ({ type: "new_msg", data: row(seq) });
const windowReqs = (sent: Sent[]) => sent.filter((f) => f.type === "window_req").map((f) => f.data);
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("实时消息登记区间（§4.8：跳号不补，登记成岛）", () => {
  it("跳号的实时消息登记成 [seq, seq]，内存与落盘都有", async () => {
    const { client, feed } = clientWithSocket("o-c4-island");
    feed(windowResp(1, 200));
    feed(newMsg(100000));
    await settle();
    expect(client.rangesOf(CID)).toEqual([{ lo: 1, hi: 200 }, { lo: 100000, hi: 100000 }]);
    const persisted = await loadRanges("o-c4-island", CID);
    expect(persisted.ranges).toEqual([{ lo: 1, hi: 200 }, { lo: 100000, hi: 100000 }]);
  });

  it("紧接尾段的实时消息把尾段往后扩（C4 之前实时消息从不进清单，↓N / 进会话判据都要白问一次）", async () => {
    const { client, feed } = clientWithSocket("o-c4-extend");
    feed(windowResp(1, 200));
    feed(newMsg(201));
    await settle();
    expect(client.rangesOf(CID)).toEqual([{ lo: 1, hi: 201 }]);
  });
});

describe("jumpToLatest（点 ↓）", () => {
  it("尾部是孤岛（本地最大 seq 已等于最新）→ 发 window_req(anchor=0) 取最新一页", async () => {
    const { client, sent, feed } = clientWithSocket("o-c4-jump-island");
    feed(windowResp(1, 200));
    feed(newMsg(100000));
    await settle();
    sent.length = 0;
    expect(client.jumpToLatest(CID, 100000, 100000)).toBe(true);
    expect(windowReqs(sent)).toEqual([{ conv_id: CID, anchor: 0, before: 200, after: 0 }]);
  });

  it("最后一页本地齐全 → 一个请求都不发，并如实返回 false（调用方据此不挂等滚动）", async () => {
    const { client, sent, feed } = clientWithSocket("o-c4-jump-local");
    feed(windowResp(801, 1000));
    await settle();
    sent.length = 0;
    expect(client.jumpToLatest(CID, 1000, 1000)).toBe(false);
    expect(windowReqs(sent)).toEqual([]);
  });
});

describe("catchUpOnBump（超级群信号到了、会话正开着）", () => {
  const bump = (latest: number) => ({ type: "conv_bump", data: { items: [{ conv_id: CID, latest_seq: latest }] } });

  it("贴底跟随、差距小 → 从尾段上沿接着取那几条", async () => {
    const { client, sent, feed } = clientWithSocket("o-c4-bump-small");
    feed(windowResp(1, 100));
    feed(bump(130));
    await settle();
    sent.length = 0;
    expect(client.catchUpOnBump(CID, 130, 100, true)).toBe(true);
    expect(windowReqs(sent)).toEqual([{ conv_id: CID, anchor: 100, before: 0, after: 30 }]);
  });

  it("贴底跟随、差距大 → 直接取最新一页", async () => {
    const { client, sent, feed } = clientWithSocket("o-c4-bump-big");
    feed(windowResp(1, 100));
    feed(bump(5000));
    await settle();
    sent.length = 0;
    expect(client.catchUpOnBump(CID, 5000, 100, true)).toBe(true);
    expect(windowReqs(sent)).toEqual([{ conv_id: CID, anchor: 0, before: 200, after: 0 }]);
  });

  it("在翻历史（没贴底）→ 不补，只有 head 跟着信号走（↓N 靠它计数）", async () => {
    const { client, sent, feed } = clientWithSocket("o-c4-bump-reading");
    feed(windowResp(1, 100));
    feed(bump(130));
    await settle();
    sent.length = 0;
    expect(client.catchUpOnBump(CID, 130, 100, false)).toBe(false);
    expect(windowReqs(sent)).toEqual([]);
    expect(client.headOf(CID)).toBe(130);
  });
});
