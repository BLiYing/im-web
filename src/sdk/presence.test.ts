import { describe, expect, it } from "vitest";

import {
  EMPTY_PRESENCE,
  isOnline,
  presenceFromConversation,
  presenceFromFrame,
  presenceText,
  type Presence,
} from "./presence";

// 在线态租约模型（2026-08-05，与 iOS IMPresenceTests 同构）：
// 服务端只推上线、不推下线，故「是否在线」必须每次按当前时间与租约重算。

const NOW = Date.UTC(2026, 7, 5, 12, 0, 0); // 固定 now，避免跨日/跨年抖动

describe("解析", () => {
  it("从会话列表项解析 peer_* 键", () => {
    const p = presenceFromConversation({
      peer_presence: "online",
      peer_online_until: NOW + 60_000,
      peer_last_seen: 12345,
    });
    expect(p).toEqual({ level: "online", onlineUntil: NOW + 60_000, lastSeen: 12345 });
  });

  it("从 presence 帧解析 status 键，从资料卡解析 presence 键", () => {
    expect(presenceFromFrame({ status: "recently", last_seen: 999 }).level).toBe("recently");
    expect(presenceFromFrame({ presence: "last_week" }).level).toBe("last_week");
  });

  it("脏数据安全：非法档位/非数字/缺字段一律落空态", () => {
    for (const bad of [null, undefined, "not an object", 42]) {
      expect(presenceFromFrame(bad)).toEqual(EMPTY_PRESENCE);
    }
    const weird = presenceFromFrame({ status: 42, online_until: "字符串", last_seen: NaN });
    expect(weird).toEqual(EMPTY_PRESENCE);
    expect(presenceText(weird, NOW)).toBe("");
  });

  it("群聊/老响应无快照字段时解析为空态，不显示占位", () => {
    const p = presenceFromConversation({ conv_id: "g_x", is_group: true });
    expect(p.level).toBeUndefined();
    expect(presenceText(p, NOW)).toBe("");
  });
});

describe("租约（服务端不推下线，靠到期本地降级）", () => {
  it("租约过期即不在线，无需服务端下线帧", () => {
    const p: Presence = { level: "online", onlineUntil: NOW - 1, lastSeen: NOW - 30_000 };
    expect(isOnline(p, NOW)).toBe(false);
    expect(presenceText(p, NOW)).toBe("刚刚在线");
  });

  it("同一份快照会随时间自行从「在线」降级", () => {
    const p: Presence = { level: "online", onlineUntil: NOW + 60_000, lastSeen: NOW - 60_000 };
    expect(presenceText(p, NOW)).toBe("在线");
    expect(presenceText(p, NOW + 61_000)).not.toBe("在线"); // 一分钟后租约已过期
  });

  it("有效租约压过陈旧的 last_seen", () => {
    const p: Presence = { onlineUntil: NOW + 60_000, lastSeen: NOW - 10 * 86_400_000 };
    expect(presenceText(p, NOW)).toBe("在线");
  });

  it("undefined（未取到快照）不算在线", () => {
    expect(isOnline(undefined, NOW)).toBe(false);
    expect(presenceText(undefined, NOW)).toBe("");
  });
});

describe("副标题文案分级", () => {
  const at = (lastSeen: number): Presence => ({ onlineUntil: 0, lastSeen });

  it("一小时内按分钟", () => {
    expect(presenceText(at(NOW - 30_000), NOW)).toBe("刚刚在线");
    expect(presenceText(at(NOW - 5 * 60_000), NOW)).toBe("5 分钟前在线");
    expect(presenceText(at(NOW - 59 * 60_000), NOW)).toBe("59 分钟前在线");
  });

  it("无精确时间时回退到粗档文案（为将来的隐私开关留位）", () => {
    expect(presenceText({ level: "recently", onlineUntil: 0, lastSeen: 0 }, NOW)).toBe("最近在线");
    expect(presenceText({ level: "last_week", onlineUntil: 0, lastSeen: 0 }, NOW)).toBe("一周内在线");
    expect(presenceText({ level: "last_month", onlineUntil: 0, lastSeen: 0 }, NOW)).toBe("一个月内在线");
    expect(presenceText({ level: "long_ago", onlineUntil: 0, lastSeen: 0 }, NOW)).toBe("很久未上线");
    expect(presenceText({ onlineUntil: 0, lastSeen: 0 }, NOW)).toBe("");
  });
});
