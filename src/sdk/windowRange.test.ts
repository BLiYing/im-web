/**
 * 开窗（window_resp）取回的那一段必须**连同区间一起落盘**（OFFLINE_BACKLOG_DESIGN §4.2 不变量 I1）。
 *
 * 现场（2026-09-05 用户实测，20000 人大群）：点置顶跳过去只渲染出 seq 1..13 十三条，整屏都放得下，
 * 而本地其实存着开窗取回的六十多条。根因是 window_resp 只把区间记进**内存**镜像、消息却按条进了
 * IndexedDB；刷新一次，"这一段我已齐全"就没了，渲染切段（renderWindow.contiguousSegments）没有清单
 * 可依，只能退回**按 conv_seq 连号**判断，于是被 msg_op 事件行 / 墓碑 / 对我不可见的行切成碎岛。
 * 上一轮 ↓N 的「区间覆盖」判据吃的也是这份清单，同样在刷新后静默失效。
 *
 * 这里白盒驱动真实的 onFrame（连 fake-indexeddb 一起跑），断言落盘结果而不是"调了哪个函数"。
 */
import { describe, it, expect } from "vitest";
import { IMClient } from "./imSdk";
import { loadRanges } from "./localStore.ranges";
import { loadConversation, loadSyncCursor } from "./localStore";

const CID = "g_win";

/** 造一台已知 uid 的客户端，绕过真实连接（本测只关心收帧后的落盘）。 */
function clientFor(owner: string): { client: IMClient; feed: (frame: unknown) => void } {
  const client = new IMClient({});
  (client as unknown as { uid: string }).uid = owner;
  return { client, feed: (f) => (client as unknown as { onFrame(raw: string): void }).onFrame(JSON.stringify(f)) };
}

const row = (seq: number, over: Record<string, unknown> = {}) => ({
  server_msg_id: `s${seq}`, conv_id: CID, from: "peer", content: `#${seq}`,
  content_type: "text", conv_seq: seq, timestamp: 1_700_000_000_000 + seq, ...over,
});

const windowResp = (messages: unknown[], anchor: number) => ({
  type: "window_resp",
  data: { conv_id: CID, anchor, anchor_found: true, has_before: true, has_after: true, messages },
});

// 等一拍：落盘是 fire-and-forget 的 void promise，断言前让微任务队列跑完。
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("window_resp 落盘", () => {
  it("消息与「这一段我已齐全」一起进库，刷新后仍在", async () => {
    const { feed } = clientFor("o-win-1");
    feed(windowResp([row(3), row(4), row(9)], 4));
    await settle();

    const { ranges } = await loadRanges("o-win-1", CID);
    expect(ranges).toEqual([{ lo: 3, hi: 9 }]); // 区间取整窗首尾，中间那几个号本就不是消息
    const msgs = await loadConversation("o-win-1", CID);
    expect(msgs.map((m) => m.convSeq)).toEqual([3, 4, 9]);
  });

  // 一窗是会话**中间的任意一段**，不是"从头连续拉到这里"。推了游标就等于宣称 1..lo-1 也已同步，
  // 那段会被永久跳过——这条不变量比区间本身更要命，故单独钉死。
  it("不推进连续同步游标", async () => {
    const { feed } = clientFor("o-win-2");
    feed(windowResp([row(5000), row(5001)], 5000));
    await settle();

    expect(await loadSyncCursor("o-win-2", CID)).toBe(0);
    expect((await loadRanges("o-win-2", CID)).ranges).toEqual([{ lo: 5000, hi: 5001 }]);
  });

  // 整窗全是 msg_op 事件行时一条消息都不产生，但"这几个号我都问过了"依旧成立——
  // 不登记的话，下次上翻到这一段边缘还会把它们当成缺口。
  it("整窗都是 msg_op 事件行时，仍然登记区间", async () => {
    const { feed } = clientFor("o-win-3");
    feed(windowResp([
      row(20, { content_type: "msg_op", content: JSON.stringify({ op: "pin", conv_seq: 7 }) }),
      row(21, { content_type: "msg_op", content: JSON.stringify({ op: "pin", conv_seq: 8 }) }),
    ], 20));
    await settle();

    expect((await loadRanges("o-win-3", CID)).ranges).toEqual([{ lo: 20, hi: 21 }]);
    expect(await loadConversation("o-win-3", CID)).toEqual([]);
  });
});
