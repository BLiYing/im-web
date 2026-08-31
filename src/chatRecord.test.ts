import { describe, it, expect } from "vitest";
import { parseChatRecord, recordItemPreview, recordSenderKey, chatRecordTitle, buildRecordSenderKeys } from "./messageContent";

// 合并转发「聊天记录」纯函数：解析 + 单条预览 token（含嵌套「套娃」→[聊天记录] 子标题）。
// 与 iOS IMMediaUtil 的 IMSummarizeRecord/IMRecordItemPreview 逐条对齐。
describe("chat_record 合并转发解析与预览", () => {
  it("parseChatRecord 解析标题与条目", () => {
    const json = JSON.stringify({ t: "群聊的聊天记录", items: [{ n: "1002", ct: "text", c: "你好" }] });
    const r = parseChatRecord(json);
    expect(r.t).toBe("群聊的聊天记录");
    expect(r.items).toHaveLength(1);
    expect(r.items[0].c).toBe("你好");
  });

  it("图说条目「有字显字」：带 cap 显 caption 文字，否则回退 token", () => {
    expect(recordItemPreview({ n: "1002", ct: "image", c: "/a.jpg", cap: "周末爬山拍的" })).toBe("周末爬山拍的");
    expect(recordItemPreview({ n: "1002", ct: "video", c: "/a.mp4", cap: "现场录像" })).toBe("现场录像");
    expect(recordItemPreview({ n: "1002", ct: "file", c: "/x__r.pdf", fn: "r.pdf", cap: "看第3页" })).toBe("看第3页");
    expect(recordItemPreview({ n: "1002", ct: "image", c: "/a.jpg" })).toBe("[图片]");
  });

  it("parseChatRecord 非法 JSON 回落默认标题、空条目", () => {
    const r = parseChatRecord("not-json");
    expect(r.t).toBe("聊天记录");
    expect(r.items).toEqual([]);
  });

  it("recordItemPreview 覆盖各消息类型的 token", () => {
    expect(recordItemPreview({ n: "a", ct: "text", c: "hi" })).toBe("hi");
    expect(recordItemPreview({ n: "a", ct: "image", c: "u" })).toBe("[图片]");
    expect(recordItemPreview({ n: "a", ct: "video", c: "u" })).toBe("[视频]");
    expect(recordItemPreview({ n: "a", ct: "file", c: "x", fn: "报表.xlsx" })).toBe("[文件] 报表.xlsx");
  });

  it("语音条目预览 = [语音] m:ss（无 d 的老记录退化成 [语音]），不铺裸 URL", () => {
    expect(recordItemPreview({ n: "a", ct: "voice", c: "/uploads/v/x.m4a", d: 12400 })).toBe("[语音] 0:12");
    expect(recordItemPreview({ n: "a", ct: "voice", c: "/uploads/v/x.m4a" })).toBe("[语音]");
  });

  it("嵌套 chat_record 条目预览 = [聊天记录] 子标题（不铺 JSON 原文）", () => {
    const child = JSON.stringify({ t: "1002和1003的聊天记录", items: [{ n: "1002", ct: "text", c: "在吗" }] });
    const preview = recordItemPreview({ n: "1001", ct: "chat_record", c: child });
    expect(preview).toBe("[聊天记录] 1002和1003的聊天记录");
    expect(preview).not.toContain("items"); // 绝不能退化成 JSON 文本
  });

  it("嵌套子 JSON 非法时不叠加默认标题（避免「[聊天记录] 聊天记录」）", () => {
    expect(recordItemPreview({ n: "1001", ct: "chat_record", c: "garbled" })).toBe("[聊天记录]");
  });
});

describe("recordSenderKey（连续同一人只显一次头像/昵称的身份判据）", () => {
  it("有 u 就按 uid：同名不同人分得开，改过昵称仍算同一人", () => {
    expect(recordSenderKey({ n: "小明", u: "1001" })).not.toBe(recordSenderKey({ n: "小明", u: "1002" }));
    expect(recordSenderKey({ n: "改过名了", u: "1001" })).toBe(recordSenderKey({ n: "小明", u: "1001" }));
  });
  it("老记录没有 u → 退回昵称；前缀保证 uid 与昵称不互撞", () => {
    expect(recordSenderKey({ n: "小明" })).toBe(recordSenderKey({ n: "小明" }));
    expect(recordSenderKey({ n: "1001" })).not.toBe(recordSenderKey({ n: "x", u: "1001" }));
  });
});

// 标题口径（2026-08-31 两端收敛）：此前 iOS 写真实群名、Web 按条目发送者数量推，同一个操作两端产出
// 不同标题；且 iOS 那份把群名发给了往往不在群里的收件人。现统一到微信口径。
describe("chatRecordTitle 合并转发卡片标题", () => {
  it("群聊固定「群聊的聊天记录」——**绝不写真实群名**", () => {
    expect(chatRecordTitle({ isGroup: true, peerName: "小明", myName: "我" })).toBe("群聊的聊天记录");
    // 即便调用方把群名塞进 peerName 也不该漏出去
    expect(chatRecordTitle({ isGroup: true, peerName: "XX病友群" })).toBe("群聊的聊天记录");
  });
  it("单聊写双方公开名（只写对方的话，收件人看不出这是「对方和谁」的对话）", () => {
    expect(chatRecordTitle({ isGroup: false, peerName: "小明", myName: "老王" })).toBe("小明和老王的聊天记录");
  });
  it("缺名逐级降级，绝不落到内部 ID：只有一边有名 → 单名；两边都没有 → 「聊天记录」", () => {
    expect(chatRecordTitle({ isGroup: false, peerName: "小明", myName: "" })).toBe("小明的聊天记录");
    expect(chatRecordTitle({ isGroup: false, peerName: "", myName: "老王" })).toBe("老王的聊天记录");
    expect(chatRecordTitle({ isGroup: false })).toBe("聊天记录");
    expect(chatRecordTitle({ isGroup: false, peerName: "   ", myName: "  " })).toBe("聊天记录");
  });
});

describe("buildRecordSenderKeys 卡片内匿名发送者序号", () => {
  it("按首次出现顺序编号，同一人复用同一个键", () => {
    const m = buildRecordSenderKeys(["4827391056", "9173628401", "4827391056"]);
    expect(m.get("4827391056")).toBe("s1");
    expect(m.get("9173628401")).toBe("s2");
    expect(m.size).toBe(2);
  });
  it("缺 from 的条目不占号（读端对这类条目退化成按名字判连续）", () => {
    const m = buildRecordSenderKeys([undefined, "1001", "", "1002"]);
    expect(m.get("1001")).toBe("s1");
    expect(m.get("1002")).toBe("s2");
    expect(m.size).toBe(2);
  });
  it("产出的键与 recordSenderKey 的相等语义相容（判连续同一人照常可用）", () => {
    const m = buildRecordSenderKeys(["1001", "1002"]);
    expect(recordSenderKey({ n: "改过名了", u: m.get("1001") })).toBe(recordSenderKey({ n: "小明", u: m.get("1001") }));
    expect(recordSenderKey({ n: "小明", u: m.get("1001") })).not.toBe(recordSenderKey({ n: "小明", u: m.get("1002") }));
  });
});
