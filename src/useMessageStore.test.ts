// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMessageStore } from "./useMessageStore";
import type { ChatMessage } from "./sdk/protocol";

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  convId: "c1", from: "u", content: "x", contentType: "text", convSeq: 0, timestamp: 0, status: "received", ...over,
});

describe("useMessageStore（去重/回执编排）", () => {
  it("ingestInbound：首次入站 → 追加并返回 true", () => {
    const { result } = renderHook(() => useMessageStore());
    let appended = false;
    act(() => { appended = result.current.ingestInbound(msg({ convSeq: 5 })); });
    expect(appended).toBe(true);
    expect(result.current.msgsByConv.c1.map((m) => m.convSeq)).toEqual([5]);
  });

  it("ingestInbound：同 conv_seq 重复 → 合并元数据、不新增、返回 false", () => {
    const { result } = renderHook(() => useMessageStore());
    act(() => { result.current.ingestInbound(msg({ convSeq: 5, serverMsgId: "s1" })); });
    let appended = true;
    act(() => { appended = result.current.ingestInbound(msg({ convSeq: 5, serverMsgId: "s2", fileName: "a.png" })); });
    expect(appended).toBe(false);
    expect(result.current.msgsByConv.c1).toHaveLength(1); // 不重复
    expect(result.current.msgsByConv.c1[0].fileName).toBe("a.png"); // 元数据补上
  });

  it("ingestInbound：本端已删的 conv_seq 重推 → 丢弃、返回 false", () => {
    const { result } = renderHook(() => useMessageStore());
    act(() => { result.current.deletedByConv.current.c1 = new Set([7]); });
    let appended = true;
    act(() => { appended = result.current.ingestInbound(msg({ convSeq: 7 })); });
    expect(appended).toBe(false);
    expect(result.current.msgsByConv.c1 ?? []).toHaveLength(0);
  });

  it("applyAck：按 clientMsgId 转已发 + 落 conv_seq + 登记去重集", () => {
    const { result } = renderHook(() => useMessageStore());
    act(() => { result.current.appendMsg("c1", msg({ clientMsgId: "cm1", convSeq: 0, status: "sent" })); });
    act(() => { result.current.applyAck("cm1", true, 42, 1700); });
    const m = result.current.msgsByConv.c1[0];
    expect(m.status).toBe("sent");
    expect(m.convSeq).toBe(42);
    expect(m.timestamp).toBe(1700);
    expect(result.current.seenByConv.current.c1.has(42)).toBe(true); // 去重集登记，防 sync 重复回显
  });

  it("applyAck 失败：转 failed，不登记去重集", () => {
    const { result } = renderHook(() => useMessageStore());
    act(() => { result.current.appendMsg("c1", msg({ clientMsgId: "cm2", convSeq: 0 })); });
    act(() => { result.current.applyAck("cm2", false, 0); });
    expect(result.current.msgsByConv.c1[0].status).toBe("failed");
    expect(result.current.seenByConv.current.c1?.has(0) ?? false).toBe(false);
  });
});
