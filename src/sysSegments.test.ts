import { describe, it, expect } from "vitest";
import { parseSysSegments, sysSegmentName, sysSegmentsText } from "./sysSegments";

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

// 「我」是这套渲染里唯一的硬规则，且**两处共用**（聊天页系统行 / 会话列表预览）——
// 漂了就会一处显「我」、一处显自己的昵称，同一句话两副面孔。
describe("sysSegmentName", () => {
  const resolve = (id: string) => (id === "1002" ? "用户1002" : `名字${id}`);

  it("是我自己 → 「我」，不走 resolve", () => {
    expect(sysSegmentName("1002", "1002", resolve)).toBe("我");
  });

  it("别人 → 交给 resolve（备注 > 群昵称 > 昵称 > 服务端字面）", () => {
    expect(sysSegmentName("3001", "1002", resolve)).toBe("名字3001");
  });

  it("uid 为空 / 未登录（selfUid 空）时不做替换，避免把别人显示成「我」", () => {
    expect(sysSegmentName("", "1002", () => "x")).toBe("x");
    expect(sysSegmentName("1002", "", resolve)).toBe("用户1002");
  });
});
