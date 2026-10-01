// 桌面通知头像「该用谁的」——与 iOS / Android 通知同口径：群聊只用群头像，单聊只用对端。
// 真画图（canvas）jsdom 不支持，那部分在桌面版上目测；这里钉住取谁的、以及画不了时照样交付。
import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "./sdk/protocol";
import { SYSTEM_UID } from "./sdk/protocol";
import { notifyIconSource, withNotifyIcon } from "./notifyIcon";

const conv = (over: Partial<Conversation>): Conversation =>
  ({ conv_id: "u_1_u_2", peer: "2", unread: 0, is_group: false, ...over } as Conversation);

describe("notifyIconSource", () => {
  it("群聊：用群头像、按群 conv_id 播种——不拿发送人的头像顶替", () => {
    const g = conv({ conv_id: "g_9", is_group: true, avatar_url: "/avatars/g.png", peer_avatar_url: "/avatars/someone.png" });
    expect(notifyIconSource(g, "g_9", "产品组")).toEqual({ url: "/avatars/g.png", label: "产品组", seed: "g_9" });
  });

  it("群没有头像：只给占位（seed=群），不回退到任何人的头像", () => {
    const g = conv({ conv_id: "g_9", is_group: true, avatar_url: "", peer_avatar_url: "/avatars/someone.png" });
    expect(notifyIconSource(g, "g_9", "产品组")).toEqual({ url: undefined, label: "产品组", seed: "g_9" });
  });

  it("单聊：用对端头像、按对端 uid 播种（与会话列表那颗圈同色）", () => {
    const p = conv({ peer: "2", peer_avatar_url: "/avatars/p.png" });
    expect(notifyIconSource(p, "u_1_u_2", "张三")).toEqual({ url: "/avatars/p.png", label: "张三", seed: "2" });
  });

  it("会话还不在列表里：按 conv_id 出占位", () => {
    expect(notifyIconSource(undefined, "u_1_u_3", "新消息")).toEqual({ label: "新消息", seed: "u_1_u_3" });
  });

  it("系统通知会话：不带头像（用应用图标）", () => {
    expect(notifyIconSource(conv({ peer: SYSTEM_UID }), "x", "系统通知")).toBeNull();
  });
});

describe("withNotifyIcon", () => {
  // 本文件跑在 node 环境（没有 document）：走的正是「画不了」那条路。
  it("画不了（无 canvas）也同步交付一次 undefined——通知照弹，只是没头像", () => {
    const deliver = vi.fn();
    withNotifyIcon({ url: "/avatars/p.png", label: "张三", seed: "2" }, deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(undefined);
  });

  it("null 来源：同步交付 undefined", () => {
    const deliver = vi.fn();
    withNotifyIcon(null, deliver);
    expect(deliver).toHaveBeenCalledWith(undefined);
  });
});
