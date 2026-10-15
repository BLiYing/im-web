import { describe, it, expect } from "vitest";
import { pinnedPreview, pinnedSenderLabel, latestPinned, pinnedBubbleMessage, pinnedMenuIds } from "./pinned";
import type { ChatMessage, PinnedMessage } from "./sdk/protocol";

describe("pinnedPreview", () => {
  it("文本原样显示", () => {
    expect(pinnedPreview({ contentType: "text", content: "共享盘链接" })).toBe("共享盘链接");
  });

  it("换行与连续空白压成单行（横幅是单行布局，换行会撑高）", () => {
    expect(pinnedPreview({ contentType: "text", content: "第一行\n第二行   缩进" })).toBe("第一行 第二行 缩进");
  });

  it("媒体/文件显类型词而不是 URL", () => {
    expect(pinnedPreview({ contentType: "image", content: "https://x/a.png" })).toBe("[图片]");
    expect(pinnedPreview({ contentType: "video", content: "https://x/a.mp4" })).toBe("[视频]");
    expect(pinnedPreview({ contentType: "file", content: "https://x/a.zip" })).toBe("[文件]");
  });

  it("图说置顶「有字显字」：带 caption 显文字，否则回退类型词", () => {
    expect(pinnedPreview({ contentType: "image", content: "https://x/a.png", caption: "周末爬山拍的" })).toBe("周末爬山拍的");
    expect(pinnedPreview({ contentType: "file", content: "https://x/a.zip", caption: "季度财报" })).toBe("季度财报");
    expect(pinnedPreview({ contentType: "image", content: "https://x/a.png" })).toBe("[图片]");
  });

  it("语音显 [语音]（voice 与旧名 audio 都要认，否则横幅铺一串 URL）", () => {
    expect(pinnedPreview({ contentType: "voice", content: "/uploads/v/a.m4a" })).toBe("[语音]");
    expect(pinnedPreview({ contentType: "audio", content: "/uploads/v/a.m4a" })).toBe("[语音]");
  });

  it("合并转发卡片显「[聊天记录] 标题」，不铺整段 JSON", () => {
    const json = JSON.stringify({ t: "小刚 的聊天记录", items: [{ n: "小刚", ct: "text", c: "在吗" }] });
    expect(pinnedPreview({ contentType: "chat_record", content: json })).toBe("[聊天记录] 小刚 的聊天记录");
    expect(pinnedPreview({ contentType: "chat_record", content: "garbled" })).toBe("[聊天记录]");
  });

  it("空文本与未知类型都有兜底，不返回空串", () => {
    expect(pinnedPreview({ contentType: "text", content: "   " })).toBe("（空消息）");
    expect(pinnedPreview({ contentType: "sticker", content: "" })).toBe("[sticker]");
  });
});

describe("pinnedSenderLabel", () => {
  it("群聊优先群内昵称，回退 uid", () => {
    expect(pinnedSenderLabel({ from: "1002", fromNickname: "小刚" }, true)).toBe("小刚");
    expect(pinnedSenderLabel({ from: "1002", fromNickname: undefined }, true)).toBe("1002");
  });

  it("单聊不显示发送者", () => {
    expect(pinnedSenderLabel({ from: "1002", fromNickname: "小刚" }, false)).toBe("");
  });
});

const pm = (convSeq: number, pinnedAt: number, over: Partial<PinnedMessage> = {}): PinnedMessage => ({
  convSeq, serverMsgId: `s${convSeq}`, from: "1002", contentType: "text", content: `第${convSeq}条`, timestamp: 1000 + convSeq, pinnedAt, ...over,
});
const cm = (convSeq: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  convId: "c1", from: "1002", content: `本地${convSeq}`, contentType: "text", convSeq, timestamp: 1, status: "received", ...over,
} as ChatMessage);

describe("latestPinned（横幅恒显最新置顶，不轮转）", () => {
  it("取 pinned_at 最大的一条，不依赖服务端排序", () => {
    expect(latestPinned([pm(1, 10), pm(2, 30), pm(3, 20)])?.convSeq).toBe(2);
  });
  it("空集合 → undefined（不显横幅）", () => {
    expect(latestPinned([])).toBeUndefined();
  });
});

describe("pinnedBubbleMessage（面板气泡兜底顺序：本地行 → 接口完整消息 → 类型词纯文本）", () => {
  it("① 本地已有该 conv_seq → 用本地行", () => {
    const full = cm(5, { content: "接口里的" });
    expect(pinnedBubbleMessage(pm(5, 1, { message: full }), [cm(5)], "c1").content).toBe("本地5");
  });
  it("本地那条已撤回 → 不用墓碑，退到接口完整消息", () => {
    const full = cm(5, { content: "接口里的", contentType: "image" });
    expect(pinnedBubbleMessage(pm(5, 1, { message: full }), [cm(5, { recalledAt: 9 })], "c1")).toBe(full);
  });
  it("② 本地没有 → 接口附带的完整消息对象", () => {
    const full = cm(6, { contentType: "video", content: "https://x/v.mp4", duration: 12 });
    expect(pinnedBubbleMessage(pm(6, 1, { message: full }), [cm(5)], "c1")).toBe(full);
  });
  it("③ 都没有（旧服务端）→ 类型词纯文本气泡，带原发送者/时间/conv_seq", () => {
    const m = pinnedBubbleMessage(pm(7, 1, { contentType: "image", content: "https://x/a.png" }), undefined, "c1");
    expect(m).toMatchObject({ contentType: "text", content: "[图片]", convSeq: 7, from: "1002", timestamp: 1007, convId: "c1" });
  });
});

describe("pinnedMenuIds（长按菜单允许项）", () => {
  it("有权限 + 文本：取消置顶 / 复制 / 定位（按此顺序）", () => {
    expect(pinnedMenuIds({ contentType: "text", content: "hi" }, true)).toEqual(["unpin", "copy", "locate"]);
  });
  it("无权限：没有取消置顶", () => {
    expect(pinnedMenuIds({ contentType: "text", content: "hi" }, false)).toEqual(["copy", "locate"]);
  });
  it("非文本（图片/文件…）：没有复制", () => {
    expect(pinnedMenuIds({ contentType: "image", content: "https://x/a.png" }, true)).toEqual(["unpin", "locate"]);
  });
});
