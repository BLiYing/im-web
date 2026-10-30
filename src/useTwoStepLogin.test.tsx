// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTwoStepLogin } from "./useTwoStepLogin";

const challenge = { code: 200020, data: { ticket: "TK", methods: ["totp"], expires_in: 300 } };
function setup() {
  const setAuthErr = vi.fn();
  const hook = renderHook((p: { phase: string }) => useTwoStepLogin({ phase: p.phase, setAuthErr }), { initialProps: { phase: "login" } });
  return { setAuthErr, hook };
}

describe("useTwoStepLogin", () => {
  it("200020 → 进二步页；非二步错误且无在途请求 → 不接管", () => {
    const { hook } = setup();
    expect(hook.result.current.intercept({ code: 200002 })).toBe(false);
    act(() => { expect(hook.result.current.intercept(challenge)).toBe(true); });
    expect(hook.result.current.view.active).toBe(true);
  });
  it("200020 缺 ticket：不接管（走通用登录错误）", () => {
    const { hook } = setup();
    expect(hook.result.current.intercept({ code: 200020, data: {} })).toBe(false);
  });
  it("提交：不满 6 位不提交；满 6 位记下 pending，take 一次性取走（带 ticket，归一后的 code）", () => {
    const { hook } = setup();
    act(() => { hook.result.current.intercept(challenge); });
    expect(hook.result.current.submit("123", "code")).toBe(false);
    expect(hook.result.current.take()).toBeUndefined();
    let ok = false;
    act(() => { ok = hook.result.current.submit("123 456", "code"); });
    expect(ok).toBe(true);
    expect(hook.result.current.take()).toEqual({ ticket: "TK", code: "123456" });
    expect(hook.result.current.take()).toBeUndefined();
  });
  it("请求在途时不重复提交", () => {
    const { hook } = setup();
    act(() => { hook.result.current.intercept(challenge); });
    act(() => { hook.result.current.submit("123456", "code"); });
    expect(hook.result.current.submit("654321", "code")).toBe(false);
  });
  it("恢复码模式：归一为小写无连字符的 10 位", () => {
    const { hook } = setup();
    act(() => { hook.result.current.intercept(challenge); hook.result.current.setMode("recovery"); });
    act(() => { hook.result.current.submit("K7M2Q-9XW3P", "recovery"); });
    expect(hook.result.current.take()?.code).toBe("k7m2q9xw3p");
  });
  it("200021：接管，显示剩余次数，清空信号 +1，ticket 仍可用于下次提交", () => {
    const { hook } = setup();
    act(() => { hook.result.current.intercept(challenge); hook.result.current.submit("111111", "code"); });
    hook.result.current.take();
    const before = hook.result.current.view.clearTick;
    act(() => { expect(hook.result.current.intercept({ code: 200021, data: { attempts_left: 2 } })).toBe(true); });
    expect(hook.result.current.view.error).toBe("验证码不正确，还可尝试 2 次");
    expect(hook.result.current.view.clearTick).toBe(before + 1);
    expect(hook.result.current.view.active).toBe(true);
    let ok = false;
    act(() => { ok = hook.result.current.submit("222222", "code"); });
    expect(ok).toBe(true);
    expect(hook.result.current.take()?.ticket).toBe("TK");
  });
  it("200022：丢 ticket、回密码页并写入 login_expired", () => {
    const { hook, setAuthErr } = setup();
    act(() => { hook.result.current.intercept(challenge); hook.result.current.submit("111111", "code"); });
    act(() => { hook.result.current.intercept({ code: 200022 }); });
    expect(hook.result.current.view.active).toBe(false);
    expect(setAuthErr).toHaveBeenCalledWith("已超时，请重新登录");
    expect(hook.result.current.submit("123456", "code")).toBe(false); // ticket 已丢
  });
  it("返回：丢 ticket 回密码页；离开登录阶段也丢", () => {
    const { hook } = setup();
    act(() => { hook.result.current.intercept(challenge); });
    act(() => { hook.result.current.back(); });
    expect(hook.result.current.view.active).toBe(false);
    expect(hook.result.current.submit("123456", "code")).toBe(false);
    act(() => { hook.result.current.intercept(challenge); });
    hook.rerender({ phase: "app" });
    expect(hook.result.current.view.active).toBe(false);
  });
});
