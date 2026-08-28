import { describe, it, expect } from "vitest";
import { remarkMap, displayNameOf } from "./remarks";
import type { FriendEntry } from "./sdk/protocol";

const f = (id: string, nickname: string, remark?: string): FriendEntry =>
  ({ user_id: id, nickname, remark, status: "accepted", updated_at: 0, blocked: false } as FriendEntry);

describe("remarkMap", () => {
  it("只收非空备注；两端空白裁掉", () => {
    const m = remarkMap([f("1001", "Alice", "  老王 "), f("1002", "Bob", "   "), f("1003", "Carol")]);
    expect(m.get("1001")).toBe("老王");
    expect(m.has("1002")).toBe(false); // 全空白 = 没设备注
    expect(m.has("1003")).toBe(false);
  });
});

describe("displayNameOf", () => {
  const remarks = remarkMap([f("1001", "Alice", "老王")]);

  it("备注 > fallback（群昵称/昵称）> uid", () => {
    expect(displayNameOf("1001", remarks, "群里的Alice")).toBe("老王");
    expect(displayNameOf("1002", remarks, "Bob")).toBe("Bob");
    expect(displayNameOf("1002", remarks, "  ")).toBe("1002");
    expect(displayNameOf("1002", remarks, null)).toBe("1002");
  });

  // 备注只改"我这台机器上看到的名字"。会发出去的内容（系统消息文本、合并转发条目名、@token）
  // 一律不经过这里——那些地方用公开名，见 ../IMServer/docs/UI.md「备注 · 隐私红线」。
  it("清掉备注后立刻回落公开名，不留旧值", () => {
    expect(displayNameOf("1001", remarkMap([f("1001", "Alice")]), "Alice")).toBe("Alice");
  });
});
