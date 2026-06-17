import { describe, it, expect } from "vitest";
import { friendlyMessage, shouldHealGap } from "./imSdk";

describe("friendlyMessage 错误码友好中文", () => {
  it("已知业务码映射为中文（被拉黑用模糊文案）", () => {
    expect(friendlyMessage(200102, "blocked by peer")).toBe("暂时无法添加对方为好友");
    expect(friendlyMessage(200002, "wrong password")).toBe("密码错误");
    expect(friendlyMessage(200101, "already friends")).toBe("你们已经是好友了");
    expect(friendlyMessage(200104, "x")).toBe("不能添加自己为好友");
    expect(friendlyMessage(100101, "invalid token")).toBe("登录已失效，请重新登录");
  });
  it("未收录码回退服务端原文", () => {
    expect(friendlyMessage(999999, "服务端原文")).toBe("服务端原文");
  });
  it("未收录且无原文给兜底", () => {
    expect(friendlyMessage(123456, "")).toBe("请求失败(123456)");
  });
});

describe("shouldHealGap 离线空洞自愈判定", () => {
  it("conv_seq 跳号(>已同步+1) 且会话在跟踪 → 需自愈", () => {
    expect(shouldHealGap(2, 5, true)).toBe(true);
  });
  it("连续(已同步+1) → 不自愈", () => {
    expect(shouldHealGap(2, 3, true)).toBe(false);
  });
  it("初始位点 0 → 不自愈（避免开会话首屏误触发）", () => {
    expect(shouldHealGap(0, 5, true)).toBe(false);
  });
  it("会话未跟踪 → 不自愈", () => {
    expect(shouldHealGap(2, 5, false)).toBe(false);
  });
  it("回退/历史分页(seq<=已同步) → 不自愈", () => {
    expect(shouldHealGap(5, 3, true)).toBe(false);
    expect(shouldHealGap(5, 5, true)).toBe(false);
  });
});
