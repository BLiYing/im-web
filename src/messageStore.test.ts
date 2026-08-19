import { describe, it, expect } from "vitest";
import {
  type MsgMap, appendTo, patchByClientMsgId, mapMatchingClientMsgId,
  mergeMetaBySeq, applyOpBySeq, removeBySeq, removeByClientMsgId,
} from "./messageStore";
import type { ChatMessage } from "./sdk/protocol";

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  convId: "c1", from: "u", content: "x", contentType: "text", convSeq: 0, timestamp: 0, status: "received", ...over,
});

describe("messageStore 纯变换", () => {
  it("appendTo：追加到会话尾；会话不存在则新建", () => {
    const m1 = msg({ convSeq: 1 });
    const a = appendTo({}, "c1", m1);
    expect(a.c1).toEqual([m1]);
    const m2 = msg({ convSeq: 2 });
    expect(appendTo(a, "c1", m2).c1.map((m) => m.convSeq)).toEqual([1, 2]);
  });

  it("patchByClientMsgId：命中会话内 clientMsgId 打补丁；会话缺失 → 原样返回同引用", () => {
    const map: MsgMap = { c1: [msg({ clientMsgId: "a", convSeq: 0 }), msg({ clientMsgId: "b", convSeq: 0 })] };
    const out = patchByClientMsgId(map, "c1", "a", { convSeq: 9, status: "sent" });
    expect(out.c1[0].convSeq).toBe(9);
    expect(out.c1[1].convSeq).toBe(0); // b 不动
    expect(patchByClientMsgId(map, "nope", "a", { convSeq: 9 })).toBe(map); // 无该会话 → 同引用
  });

  it("mapMatchingClientMsgId：跨所有会话按 clientMsgId 应用 fn，非匹配不动", () => {
    const map: MsgMap = { c1: [msg({ clientMsgId: "a" })], c2: [msg({ clientMsgId: "a" }), msg({ clientMsgId: "z" })] };
    const out = mapMatchingClientMsgId(map, "a", (m, cid) => ({ ...m, content: `hit-${cid}` }));
    expect(out.c1[0].content).toBe("hit-c1");
    expect(out.c2[0].content).toBe("hit-c2");
    expect(out.c2[1].content).toBe("x"); // z 不动
  });

  it("mergeMetaBySeq：只覆盖有值字段，不把已确认元数据清空；fileSize 仅正值才盖", () => {
    const map: MsgMap = { c1: [msg({ convSeq: 5, serverMsgId: "old", fileName: "a.png", fileSize: 100 })] };
    // 权威重拉：带新 serverMsgId + 撤回态，但 fileName 空、fileSize 0（不应清掉旧值）
    const out = mergeMetaBySeq(map, "c1", msg({ convSeq: 5, serverMsgId: "new", fileName: "", fileSize: 0, recalledAt: 123 }));
    expect(out.c1[0].serverMsgId).toBe("new");
    expect(out.c1[0].fileName).toBe("a.png"); // 空不盖
    expect(out.c1[0].fileSize).toBe(100);     // 0 不盖
    expect(out.c1[0].recalledAt).toBe(123);   // 撤回态补上
  });

  it("applyOpBySeq：按 conv_seq 打补丁；会话缺失 → 同引用", () => {
    const map: MsgMap = { c1: [msg({ convSeq: 5 }), msg({ convSeq: 6 })] };
    const out = applyOpBySeq(map, "c1", 6, { recalledAt: 9 });
    expect(out.c1[1].recalledAt).toBe(9);
    expect(out.c1[0].recalledAt).toBeUndefined();
    expect(applyOpBySeq(map, "zz", 6, { recalledAt: 9 })).toBe(map);
  });

  it("removeBySeq：移除匹配项；无匹配 → **同引用**（省渲染）", () => {
    const map: MsgMap = { c1: [msg({ convSeq: 5 }), msg({ convSeq: 6 })] };
    expect(removeBySeq(map, "c1", 5).c1.map((m) => m.convSeq)).toEqual([6]);
    expect(removeBySeq(map, "c1", 999)).toBe(map); // 无匹配 → 同引用
    expect(removeBySeq(map, "zz", 5)).toBe(map);   // 无该会话 → 同引用
  });

  it("removeByClientMsgId：按 clientMsgId 移除本地行", () => {
    const map: MsgMap = { c1: [msg({ clientMsgId: "a" }), msg({ clientMsgId: "b" })] };
    expect(removeByClientMsgId(map, "c1", "a").c1.map((m) => m.clientMsgId)).toEqual(["b"]);
    expect(removeByClientMsgId(map, "zz", "a")).toBe(map);
  });
});
