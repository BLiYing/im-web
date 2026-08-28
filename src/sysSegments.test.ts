import { describe, it, expect } from "vitest";
import { parseSysSegments, sysSegmentsText } from "./sysSegments";

// 分段来自服务端，收端必须脏数据安全：解析不出就回退整句（= 历史系统消息的老样子），
// 绝不能因为一条脏消息把整个消息列表渲染炸掉。
describe("parseSysSegments", () => {
  it("正常分段：带 uid 的是名字段，不带的是固定文案", () => {
    const segs = parseSysSegments([
      { uid: "1001", text: "张三" }, { text: " 邀请 " }, { uid: "1002", text: "李四" }, { text: " 加入群聊" },
    ]);
    expect(segs).toEqual([
      { uid: "1001", text: "张三" }, { text: " 邀请 " }, { uid: "1002", text: "李四" }, { text: " 加入群聊" },
    ]);
    expect(sysSegmentsText(segs)).toBe("张三 邀请 李四 加入群聊");
  });

  it("非数组 / 空数组 → undefined（回退按 content 整句渲染）", () => {
    expect(parseSysSegments(undefined)).toBeUndefined();
    expect(parseSysSegments(null)).toBeUndefined();
    expect(parseSysSegments("张三 邀请 李四")).toBeUndefined();
    expect(parseSysSegments([])).toBeUndefined();
    expect(sysSegmentsText(undefined)).toBeUndefined();
  });

  it("丢掉非对象项与无 text 的项；全丢光则 undefined", () => {
    expect(parseSysSegments([null, 42, { uid: "1001" }, { text: "" }, { text: "ok" }]))
      .toEqual([{ text: "ok" }]);
    expect(parseSysSegments([null, { text: "" }, { uid: "x" }])).toBeUndefined();
  });

  it("uid 非字符串/空串 → 退化成不可点的固定文案段（不会挂错跳转）", () => {
    expect(parseSysSegments([{ uid: 42, text: "张三" }, { uid: "", text: "李四" }]))
      .toEqual([{ text: "张三" }, { text: "李四" }]);
  });
});
