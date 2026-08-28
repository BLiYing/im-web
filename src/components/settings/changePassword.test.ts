import { describe, it, expect } from "vitest";
import { validateChangePassword } from "./changePassword";

describe("validateChangePassword", () => {
  it("空当前密码 → 提示输入", () => {
    expect(validateChangePassword("", "newpass1", "newpass1")).toBe("请输入当前密码");
  });
  it("新密码不足 6 位 → 强度提示", () => {
    expect(validateChangePassword("old123", "abc", "abc")).toBe("新密码至少 6 位");
  });
  it("新旧密码相同 → 拒绝", () => {
    expect(validateChangePassword("same12", "same12", "same12")).toBe("新密码不能与当前密码相同");
  });
  it("两次新密码不一致 → 拒绝", () => {
    expect(validateChangePassword("old123", "newpass1", "newpass2")).toBe("两次输入的新密码不一致");
  });
  it("全部合规 → 空串放行", () => {
    expect(validateChangePassword("old123", "newpass1", "newpass1")).toBe("");
  });
  it("校验顺序：既太短又不一致时先报太短", () => {
    expect(validateChangePassword("old123", "ab", "zz")).toBe("新密码至少 6 位");
  });
});
