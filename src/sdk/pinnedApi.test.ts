// 置顶面板 v3 的 SDK 侧（PINNED_PANEL_DESIGN §4）：`GET /pinned` 每项的完整消息对象解析、`POST /pinned/clear`、
// 以及一键取消所有置顶的批量广播帧 `msg_op{op:pin,pinned:false,targets}`——收端必须**逐条**按取消置顶应用（并登记事件行），
// 只按单条帧处理的话 target_conv_seq 缺省 → 整帧被丢掉，别的端点完「取消所有」本端横幅纹丝不动。
import { afterEach, describe, expect, it, vi } from "vitest";
import { batchUnpinTargetsOf, clearPinned, parsePinnedItems } from "./pinnedApi";
import { IMClient } from "./imSdk";
import type { MsgOpPatch } from "./protocol";

afterEach(() => { vi.unstubAllGlobals(); });

const item = (seq: number, extra: Record<string, unknown> = {}) => ({
  conv_seq: seq, server_msg_id: `s${seq}`, sender: "1002", content_type: "image", content: "/uploads/a.jpg",
  timestamp: 100 + seq, pinned_at: 1000 + seq, ...extra,
});

describe("parsePinnedItems", () => {
  it("每项的 message（与 new_msg 同形）走现有消息解析 → 气泡模型（媒体元数据都在）", () => {
    const [p] = parsePinnedItems({ items: [item(5, { message: {
      server_msg_id: "s5", conv_id: "g1", conv_seq: 5, from: "1002", content_type: "image", content: "/uploads/a.jpg",
      media_w: 640, media_h: 480, caption: "合影", timestamp: 105,
    } })] }, "g1");
    expect(p).toMatchObject({ convSeq: 5, pinnedAt: 1005, contentType: "image" });
    expect(p.message).toMatchObject({ convId: "g1", convSeq: 5, mediaW: 640, mediaH: 480, caption: "合影", status: "received" });
  });

  it("旧服务端不带 message / 脏数据（非对象、缺 conv_seq）→ message 为 undefined，平铺字段照旧", () => {
    const items = parsePinnedItems({ items: [item(1), item(2, { message: "x" }), item(3, { message: { content: "no seq" } })] }, "g1");
    expect(items.map((p) => p.message)).toEqual([undefined, undefined, undefined]);
    expect(items.map((p) => p.convSeq)).toEqual([1, 2, 3]);
  });

  it("message 缺 conv_id 时回填为本会话", () => {
    const [p] = parsePinnedItems({ items: [item(4, { message: { conv_seq: 4, from: "1002", content: "hi" } })] }, "u_1_2");
    expect(p.message?.convId).toBe("u_1_2");
  });

  it("items 缺失 / 非数组 → 空集合", () => {
    expect(parsePinnedItems(undefined, "g1")).toEqual([]);
    expect(parsePinnedItems({ items: {} }, "g1")).toEqual([]);
  });
});

describe("clearPinned", () => {
  it("POST /conversations/{id}/pinned/clear 一次，回服务端清除条数", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(u), method: init?.method });
      return new Response(JSON.stringify({ code: 0, data: { conv_id: "g 1", cleared: 3 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    expect(await clearPinned("jwt", "g 1")).toBe(3);
    expect(calls).toEqual([{ url: "/api/v1/conversations/g%201/pinned/clear", method: "POST" }]);
  });

  it("越权（300006）整单失败 → 抛错（面板据此 toast + 重拉）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 300006, message: "无权限" }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(clearPinned("jwt", "g1")).rejects.toThrow();
  });
});

describe("batchUnpinTargetsOf", () => {
  it("只认 op=pin 且 pinned=false 且带 targets 的帧", () => {
    const targets = [{ target_conv_seq: 3, op_conv_seq: 9 }, { target_conv_seq: 5, op_conv_seq: 10 }];
    expect(batchUnpinTargetsOf({ op: "pin", pinned: false, targets })).toEqual({ seqs: [3, 5], opSeqs: [9, 10] });
    expect(batchUnpinTargetsOf({ op: "pin", pinned: true, targets })).toBeNull();
    expect(batchUnpinTargetsOf({ op: "delete", pinned: false, targets })).toBeNull();
    expect(batchUnpinTargetsOf({ op: "pin", pinned: false })).toBeNull(); // 单条帧（target_conv_seq）
  });
});

describe("IMClient 收批量取消置顶帧", () => {
  it("一帧 targets → 每个目标各回调一次 onMsgOp(pinnedAt=0)，事件行 seq 登记进区间清单", async () => {
    const ops: Array<[string, number, MsgOpPatch]> = [];
    const client = new IMClient({ onMsgOp: (c, s, patch) => ops.push([c, s, patch]) });
    (client as unknown as { uid: string }).uid = "o-pin-batch";
    const feed = (f: unknown) => (client as unknown as { onFrame(raw: string): void }).onFrame(JSON.stringify(f));
    feed({ type: "msg_op", data: { op: "pin", pinned: false, conv_id: "g_pb", by: "1001", timestamp: 1,
      targets: [{ target_conv_seq: 2, op_conv_seq: 4 }, { target_conv_seq: 3, op_conv_seq: 5 }] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(ops).toEqual([["g_pb", 2, { pinnedAt: 0 }], ["g_pb", 3, { pinnedAt: 0 }]]);
    expect(client.rangesOf("g_pb")).toEqual([{ lo: 4, hi: 5 }]);
  });
});
