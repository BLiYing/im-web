// P3：新增 sys_event/sys_args/reply_snapshot_kind/reply_snapshot_args 四个字段的解析——
// 脏数据安全是硬要求（服务端下发未经本端校验），非字符串/非对象值一律丢弃，不抛。
import { describe, it, expect } from "vitest";
import { parseIncomingMessage } from "./parseMessage";

describe("parseIncomingMessage：P3 新字段", () => {
  it("正常收下 sys_event/sys_args", () => {
    const m = parseIncomingMessage({
      conv_id: "c1", from: "1001", content_type: "system", conv_seq: 1,
      sys_event: "member_remove", sys_args: { actor: "1001" },
    });
    expect(m.sysEvent).toBe("member_remove");
    expect(m.sysArgs).toEqual({ actor: "1001" });
  });

  it("正常收下 reply_snapshot_kind/reply_snapshot_args", () => {
    const m = parseIncomingMessage({
      conv_id: "c1", from: "1001", content_type: "text", conv_seq: 1,
      reply_snapshot_kind: "file", reply_snapshot_args: { name: "a.txt" },
    });
    expect(m.replySnapshotKind).toBe("file");
    expect(m.replySnapshotArgs).toEqual({ name: "a.txt" });
  });

  it("缺失 → undefined（老消息/未识别事件的回退路径靠这个）", () => {
    const m = parseIncomingMessage({ conv_id: "c1", from: "1001", content_type: "text", conv_seq: 1 });
    expect(m.sysEvent).toBeUndefined();
    expect(m.sysArgs).toBeUndefined();
    expect(m.replySnapshotKind).toBeUndefined();
    expect(m.replySnapshotArgs).toBeUndefined();
  });

  it("脏数据安全：非字符串 sys_event、非对象/值非字符串的 sys_args 一律丢弃，不抛", () => {
    const m = parseIncomingMessage({
      conv_id: "c1", from: "1001", content_type: "system", conv_seq: 1,
      sys_event: 42, sys_args: "not an object",
    });
    expect(m.sysEvent).toBeUndefined();
    expect(m.sysArgs).toBeUndefined();
    const m2 = parseIncomingMessage({
      conv_id: "c1", from: "1001", content_type: "system", conv_seq: 1,
      sys_event: "member_join", sys_args: { actor: "1001", bad: 42, worse: null },
    });
    expect(m2.sysArgs).toEqual({ actor: "1001" }); // 非字符串值的键整个丢弃，不是转成 "42"
  });

  it("空字符串 sys_event 按未识别处理（不是把空串当合法事件名）", () => {
    const m = parseIncomingMessage({ conv_id: "c1", from: "1001", content_type: "system", conv_seq: 1, sys_event: "" });
    expect(m.sysEvent).toBeUndefined();
  });
});
