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

  it("备注 > fallback（群昵称/昵称）> 占位（**不回落内部 ID**）", () => {
    expect(displayNameOf("1001", remarks, "群里的Alice")).toBe("老王");
    expect(displayNameOf("1002", remarks, "Bob")).toBe("Bob");
    // 末级兜底是占位文案，**不是 uid**：uid 是 10 位随机内部 ID，露出来对用户毫无意义
    // （见 ../IMServer/docs/ACCOUNT_IDENTITY_REDESIGN.md §5.2）。
    expect(displayNameOf("1002", remarks, "  ")).toBe("未命名用户");
    expect(displayNameOf("1002", remarks, null)).toBe("未命名用户");
  });

  // 备注只改"我这台机器上看到的名字"。会发出去的内容（系统消息文本、合并转发条目名、@token）
  // 一律不经过这里——那些地方用公开名，见 ../IMServer/docs/UI.md「备注 · 隐私红线」。
  it("清掉备注后立刻回落公开名，不留旧值", () => {
    expect(displayNameOf("1001", remarkMap([f("1001", "Alice")]), "Alice")).toBe("Alice");
  });
});

// 会话列表预览 / 系统消息 / 引用条 / typing 副标题都靠这一层把名字换成本机显示名。
// 三处 fallback 链一致：备注 > 群昵称/昵称 > 服务端字面 > 占位。
// 末级刻意**不是** uid——它是 10 位随机内部 ID，露在界面上对用户毫无意义。
describe("displayNameOf 在各展示位的 fallback 链", () => {
  const remarks = remarkMap([f("1002", "李四", "二两肉")]);

  it("系统消息分段：有备注显备注，没有则显服务端字面（公开昵称）", () => {
    expect(displayNameOf("1002", remarks, "李四")).toBe("二两肉");
    expect(displayNameOf("1001", remarks, "张三")).toBe("张三");
  });

  it("群昵称作 fallback 时同样被备注顶掉；都没有则给占位而非 uid", () => {
    expect(displayNameOf("1002", remarks, "群里的李四")).toBe("二两肉");
    expect(displayNameOf("1003", remarks, "群里的王五")).toBe("群里的王五");
    expect(displayNameOf("1003", remarks, undefined)).toBe("未命名用户");
  });
});
