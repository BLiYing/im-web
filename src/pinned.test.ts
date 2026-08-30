import { describe, it, expect } from "vitest";
import { pinnedPreview, pinnedSenderLabel, nextPinnedIndex, clampPinnedIndex } from "./pinned";

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

describe("index 轮转与夹紧", () => {
  it("点横幅按顺序轮转，到末尾回到第一条", () => {
    expect(nextPinnedIndex(0, 3)).toBe(1);
    expect(nextPinnedIndex(2, 3)).toBe(0);
  });

  it("空列表恒为 0，不产生 NaN/-1", () => {
    expect(nextPinnedIndex(0, 0)).toBe(0);
    expect(clampPinnedIndex(5, 0)).toBe(0);
  });

  it("别人取消置顶导致列表变短时，越界索引回到 0（否则横幅空白）", () => {
    expect(clampPinnedIndex(2, 2)).toBe(0);
    expect(clampPinnedIndex(1, 2)).toBe(1);
    expect(clampPinnedIndex(-1, 2)).toBe(0);
  });
});
