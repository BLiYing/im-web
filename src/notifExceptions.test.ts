import { describe, it, expect } from "vitest";
import { isExceptionPickable } from "./notifExceptions";
import type { Conversation } from "./sdk/protocol";

const base: Conversation = {
  conv_id: "c1",
  is_group: false,
  peer: "1002",
  unread: 0,
  read_seq: 0,
  peer_read_seq: 0,
} as Conversation;

describe("isExceptionPickable（添加例外选择页过滤，纯函数）", () => {
  it("未免打扰的会话可选", () => {
    expect(isExceptionPickable({ ...base, muted: false })).toBe(true);
  });

  it("没有 muted 字段（缺省=未免打扰）可选", () => {
    const { muted: _muted, ...rest } = { ...base, muted: undefined };
    expect(isExceptionPickable(rest as Conversation)).toBe(true);
  });

  it("已免打扰的会话不可选", () => {
    expect(isExceptionPickable({ ...base, muted: true })).toBe(false);
  });
});
