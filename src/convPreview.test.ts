// convPreview：会话列表那一行的预览文本。抽出 App.tsx 后才测得到——而它踩过的坑
// 恰恰是"看一眼像对的、真数据才露馅"那一类（整串 JSON 显在列表上、同一句话两副面孔）。
import { describe, it, expect } from "vitest";
import { convPreview, mediaPreview } from "./convPreview";
import type { Conversation } from "./sdk/protocol";
import { CONTACT_CONTENT_TYPE } from "./contactCard";

const ME = "1001";
const PEER = "1002";
// 本机显示名：备注表里 1002 = 老王，其余回退传进来的 fallback。
const localNameOf = (id: string, _cid: string, fallback?: string) =>
  (id === PEER ? "老王" : (fallback || "未命名用户"));
const deps = { uid: ME, localNameOf };

const conv = (last: Record<string, unknown> | null, o: Partial<Conversation> = {}): Conversation =>
  ({ conv_id: "c1", peer: PEER, is_group: false, last_message: last, ...o } as Conversation);

describe("mediaPreview：类型占位", () => {
  it("图片/视频/文件/聊天记录", () => {
    expect(mediaPreview("image")).toBe("[图片]");
    expect(mediaPreview("video")).toBe("[视频]");
    expect(mediaPreview("file")).toBe("[文件]");
    expect(mediaPreview("chat_record")).toBe("[聊天记录]");
    expect(mediaPreview("text")).toBeNull(); // 纯文本没有占位，调用方用正文
  });
  it("语音带 m:ss——不给 duration 就退化成 0:00", () => {
    expect(mediaPreview("voice", { duration: 95000 })).toBe("[语音] 1:35");
    expect(mediaPreview("voice")).toBe("[语音] 0:00");
  });
  // 曾漏给 contact 传 content，会话列表上直接显出 {"u":"1002",…} 整串 JSON（用户实测发现）。
  it("名片必须拿 content 才认得出昵称", () => {
    const card = JSON.stringify({ u: PEER, n: "小明", un: "xm" });
    expect(mediaPreview(CONTACT_CONTENT_TYPE, { content: card })).toContain("小明");
    expect(mediaPreview(CONTACT_CONTENT_TYPE, { content: card })).not.toContain('{"u"');
  });
});

describe("convPreview", () => {
  it("无消息 → 占位", () => {
    expect(convPreview(conv(null), deps)).toBe("（无消息）");
  });
  it("撤回：自己 →「你撤回了一条消息」；单聊对方 →「对方」；群里显名字", () => {
    expect(convPreview(conv({ from: ME, recalled_at: 1 }), deps)).toBe("你撤回了一条消息");
    expect(convPreview(conv({ from: PEER, recalled_at: 1 }), deps)).toBe("对方撤回了一条消息");
    expect(convPreview(conv({ from: PEER, recalled_at: 1 }, { is_group: true }), deps)).toBe("老王撤回了一条消息");
  });
  it("群聊带发送者前缀，自己显「我」——名字走**本机**显示名（否则列表显真名、点进去显备注）", () => {
    expect(convPreview(conv({ from: PEER, content_type: "text", content: "在吗" }, { is_group: true }), deps))
      .toBe("老王: 在吗");
    expect(convPreview(conv({ from: ME, content_type: "text", content: "在" }, { is_group: true }), deps)).toBe("我: 在");
  });
  it("图说「有字显字」：带 caption 优先显 caption，否则回退 [图片]", () => {
    expect(convPreview(conv({ from: PEER, content_type: "image", content: "/a.jpg", caption: "周末爬山" }), deps))
      .toBe("周末爬山");
    expect(convPreview(conv({ from: PEER, content_type: "image", content: "/a.jpg" }), deps)).toBe("[图片]");
  });
  it("系统消息按分段拼、名字换本机显示名、自己那段显「我」；无发送者前缀", () => {
    const c = conv({
      from: PEER, content_type: "system", content: "用户1002 邀请 用户1001 加入群聊",
      sys_segments: [{ uid: PEER, text: "用户1002" }, { text: " 邀请 " }, { uid: ME, text: "用户1001" }, { text: " 加入群聊" }],
    }, { is_group: true });
    expect(convPreview(c, deps)).toBe("老王 邀请 我 加入群聊");
  });
  it("历史系统消息没有分段 → 回退整句（别渲染成空）", () => {
    const c = conv({ from: PEER, content_type: "system", content: "用户1002 邀请 用户1001 加入群聊" }, { is_group: true });
    expect(convPreview(c, deps)).toBe("用户1002 邀请 用户1001 加入群聊");
  });
  // P3：sys_event/sys_args 随 last_message 下发时，预览按 §1 同一套算法本地化——不挂点击，
  // 人名槽位直接用解析后的纯文本（与聊天页系统行共用 buildGroupSysSegments，只是不再走 renderSysLine）。
  it("P3：sys_event 非空时按事件模板重建、名字换本机显示名（不可点，纯文本）", () => {
    const c = conv({
      from: PEER, content_type: "system", sys_event: "member_remove",
      sys_segments: [{ uid: PEER, text: "老王" }, { uid: "1003", text: "小赵" }],
    }, { is_group: true });
    expect(convPreview(c, deps)).toBe("老王 将 小赵 移出群聊");
  });
  it("P3：sys_event 不认识/为空则回退 sys_segments/content（不破坏现有回退路径）", () => {
    const unknown = conv({ from: PEER, content_type: "system", sys_event: "some_future_event", content: "整句兜底" }, { is_group: true });
    expect(convPreview(unknown, deps)).toBe("整句兜底");
  });
});
