// @vitest-environment jsdom
// 通话记录发送：主叫才发、幂等 id、失败（ack 失败 / 被拉黑）吞掉——不留红❗行、不打扰。
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useMessageStore } from "./useMessageStore";
import { useCallRecordSend } from "./useCallRecordSend";
import type { CallSummaryEvent } from "./callRecord";
afterEach(cleanup);

const ev: CallSummaryEvent = {
  callId: "c9", mediaType: "audio", reason: "no_answer", durationSec: 0, isGroup: false, role: "caller", peer: "1003", chatGroupId: "",
};

function setup() {
  const sendMedia = vi.fn(() => "call-c9");
  const clientRef = { current: { sendMedia } as never };
  const store = renderHook(() => useMessageStore());
  const send = renderHook(() => useCallRecordSend({ clientRef, uid: "1001", appendMsg: store.result.current.appendMsg }));
  return { sendMedia, store, send };
}

describe("useCallRecordSend", () => {
  it("主叫：sendMedia(call) 带 client_msg_id，并本地回显 sending", () => {
    const { sendMedia, store, send } = setup();
    act(() => send.result.current.sendCallRecord(ev));
    expect(sendMedia).toHaveBeenCalledWith(expect.stringContaining('"cid":"c9"'), "call", "1003", "u_1001_u_1003", { clientMsgId: "call-c9" });
    expect(store.result.current.msgsByConv["u_1001_u_1003"][0]).toMatchObject({ contentType: "call", status: "sending", from: "1001" });
  });
  it("被叫：什么都不发", () => {
    const { sendMedia, store, send } = setup();
    act(() => send.result.current.sendCallRecord({ ...ev, role: "callee" }));
    expect(sendMedia).not.toHaveBeenCalled();
    expect(store.result.current.msgsByConv).toEqual({});
  });
  it("ack 成功 → 转 sent；被拒（200102）→ 本地行被抹掉，不留 failed", () => {
    const a = setup();
    act(() => a.send.result.current.sendCallRecord(ev));
    act(() => a.store.result.current.applyAck("call-c9", true, 8, 5));
    expect(a.store.result.current.msgsByConv["u_1001_u_1003"][0].status).toBe("sent");

    const b = setup();
    act(() => b.send.result.current.sendCallRecord({ ...ev, callId: "c10" }));
    act(() => b.store.result.current.markRejected("call-c10", "对方已拉黑", 200102));
    expect(b.store.result.current.msgsByConv["u_1001_u_1003"]).toEqual([]);
  });
  it("ack 失败（超时等）同样抹掉；普通消息失败不受影响", () => {
    const { store, send } = setup();
    act(() => send.result.current.sendCallRecord({ ...ev, callId: "c11" }));
    act(() => store.result.current.applyAck("call-c11", false, 0));
    expect(store.result.current.msgsByConv["u_1001_u_1003"]).toEqual([]);
    act(() => store.result.current.appendMsg("c1", { convId: "c1", from: "1001", content: "hi", contentType: "text", convSeq: 0, timestamp: 0, status: "sending", clientMsgId: "t1" }));
    act(() => store.result.current.applyAck("t1", false, 0));
    expect(store.result.current.msgsByConv["c1"][0].status).toBe("failed");
  });
});
