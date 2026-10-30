// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTwoStep, type TwoStepApiLike } from "./useTwoStep";

const CODES = Array.from({ length: 10 }, (_, i) => `aaaa${i}-bbbb${i}`);
function setup(over: Partial<TwoStepApiLike> = {}, initial = { enabled: false, enabledAt: 0, recoveryRemaining: 0 }, confirm = true) {
  let status = initial; // 服务端当前状态：enable 成功后变为已开启，disable 后变回关闭（refresh 读到的就是它）
  const api: TwoStepApiLike = {
    status: vi.fn(async () => status),
    setup: vi.fn(async () => ({ secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/IM:x?secret=JBSWY3DPEHPK3PXP", expiresIn: 1800 })),
    enable: vi.fn(async () => { status = { enabled: true, enabledAt: 1, recoveryRemaining: 10 }; return CODES; }),
    disable: vi.fn(async () => { status = { enabled: false, enabledAt: 0, recoveryRemaining: 0 }; }),
    regenerate: vi.fn(async () => CODES),
    ...over,
  };
  const askConfirm = vi.fn(async (_m: string, _o?: object) => confirm);
  const setToast = vi.fn();
  const hook = renderHook(() => useTwoStep({ owner: "u1", token: () => "tok", askConfirm, setToast, api }));
  return { api, askConfirm, setToast, hook, r: () => hook.result.current };
}
const err = (code: number, data?: unknown) => Object.assign(new Error("x"), { code, data });

describe("useTwoStep · 开启流程", () => {
  it("关闭态：加载前 loading → 介绍页；开启态 → 状态页", async () => {
    const t = setup();
    expect(t.r().page).toBe("loading");
    await act(async () => { await t.r().refresh(); });
    expect(t.r().page).toBe("intro");
    const on = setup({}, { enabled: true, enabledAt: 1, recoveryRemaining: 8 });
    await act(async () => { await on.r().refresh(); });
    expect(on.r().page).toBe("status");
  });
  it("状态加载失败：当 off，不抛、不弹错", async () => {
    const t = setup({ status: vi.fn(async () => { throw new Error("net"); }) });
    await act(async () => { await t.r().refresh(); });
    expect(t.r().page).toBe("intro");
    expect(t.r().error).toBe("");
  });
  it("密码错：停在验证密码页并给红字；对：进绑定页并带密钥", async () => {
    const setupFn = vi.fn().mockRejectedValueOnce(err(200002)).mockResolvedValue({ secret: "S", otpauthUri: "u", expiresIn: 1800 });
    const t = setup({ setup: setupFn });
    await act(async () => { await t.r().refresh(); t.r().startFlow(); });
    expect(t.r().page).toBe("verifyPw");
    await act(async () => { await t.r().submitPassword("bad"); });
    expect(t.r().page).toBe("verifyPw");
    expect(t.r().error).toBe("密码不正确");
    await act(async () => { await t.r().submitPassword("good"); });
    expect(t.r().page).toBe("bind");
    expect(t.r().error).toBe("");
    expect(t.r().setup?.secret).toBe("S");
  });
  it("绑定：错码保持在绑定页、报错；对码 → 恢复码页（10 个）且状态变为已开启", async () => {
    const enable = vi.fn().mockRejectedValueOnce(err(200021)).mockResolvedValue(CODES);
    const t = setup({ enable });
    await act(async () => { await t.r().refresh(); t.r().startFlow(); await t.r().submitPassword("pw"); });
    await act(async () => { await t.r().submitBind("000000"); });
    expect(t.r().page).toBe("bind");
    expect(t.r().error).toBe("验证码不正确，请检查认证器里的最新一个");
    await act(async () => { await t.r().submitBind("123 456"); });
    expect(enable).toHaveBeenLastCalledWith("tok", "123456");
    expect(t.r().page).toBe("codes");
    expect(t.r().codes).toHaveLength(10);
    expect(t.r().status?.enabled).toBe(true);
    expect(t.r().setup).toBeNull(); // 密钥不留
  });
  it("待确认超时 200022：回验证密码页并提示超时", async () => {
    const t = setup({ enable: vi.fn(async () => { throw err(200022); }) });
    await act(async () => { await t.r().refresh(); t.r().startFlow(); await t.r().submitPassword("pw"); });
    await act(async () => { await t.r().submitBind("123456"); });
    expect(t.r().page).toBe("verifyPw");
    expect(t.r().error).toBe("已超时，请重新开始");
  });
  it("重复提交被挡：在途时再点不会再发请求", async () => {
    let release: (v: string[]) => void = () => {};
    const enable = vi.fn(() => new Promise<string[]>((res) => { release = res; }));
    const t = setup({ enable });
    await act(async () => { await t.r().refresh(); t.r().startFlow(); await t.r().submitPassword("pw"); });
    let p1: Promise<void> = Promise.resolve();
    act(() => { p1 = t.r().submitBind("123456"); });
    await act(async () => { await t.r().submitBind("123456"); });
    expect(enable).toHaveBeenCalledTimes(1);
    expect(t.r().busy).toBe(true);
    await act(async () => { release(CODES); await p1; });
    expect(t.r().page).toBe("codes");
  });
});

describe("useTwoStep · 恢复码页离开拦截", () => {
  async function toCodes() {
    const t = setup();
    await act(async () => { await t.r().refresh(); t.r().startFlow(); await t.r().submitPassword("pw"); await t.r().submitBind("123456"); });
    return t;
  }
  it("未勾选：离开要二次确认；取消则留在恢复码页", async () => {
    const t = await toCodes();
    t.askConfirm.mockResolvedValueOnce(false);
    let left = true;
    await act(async () => { left = await t.r().leaveCodes(); });
    expect(left).toBe(false);
    expect(t.r().page).toBe("codes");
    expect(t.askConfirm).toHaveBeenCalledTimes(1);
  });
  it("未勾选 + 确认离开：回状态页，标记「未保存」（状态页提示重新生成）", async () => {
    const t = await toCodes();
    await act(async () => { await t.r().leaveCodes(); });
    expect(t.r().page).toBe("status");
    expect(t.r().unsaved).toBe(true);
    expect(t.r().codes).toEqual([]);
  });
  it("已勾选：离开不弹确认；「完成」要先勾选", async () => {
    const t = await toCodes();
    act(() => { t.r().finishCodes(); });
    expect(t.r().page).toBe("codes"); // 未勾选，完成无效
    act(() => { t.r().setSaved(true); });
    await act(async () => { t.r().finishCodes(); });
    expect(t.r().page).toBe("status");
    expect(t.setToast).toHaveBeenCalledWith("两步验证已开启");
    expect(t.askConfirm).not.toHaveBeenCalled();
    expect(t.r().unsaved).toBe(false);
  });
  it("请求在途时关闭面板：close 不丢结果，重开仍是恢复码页", async () => {
    let release: (v: string[]) => void = () => {};
    const t = setup({ enable: vi.fn(() => new Promise<string[]>((res) => { release = res; })) });
    await act(async () => { await t.r().refresh(); t.r().startFlow(); await t.r().submitPassword("pw"); });
    let p: Promise<void> = Promise.resolve();
    act(() => { p = t.r().submitBind("123456"); });
    act(() => { t.r().close(); });
    await act(async () => { release(CODES); await p; });
    expect(t.r().page).toBe("codes");
    act(() => { t.r().close(); }); // 恢复码未处理：同样保留
    expect(t.r().page).toBe("codes");
  });
});

describe("useTwoStep · 状态页动作", () => {
  const on = { enabled: true, enabledAt: 1, recoveryRemaining: 2 };
  it("重新生成：密码 + 动态码 → 新 10 个码；可切恢复码（归一后提交）", async () => {
    const regenerate = vi.fn(async () => CODES);
    const t = setup({ regenerate }, on);
    await act(async () => { await t.r().refresh(); t.r().openAction("regen"); });
    expect(t.r().page).toBe("regen");
    await act(async () => { await t.r().submitAction("regen", "pw", "recovery", "K7M2Q-9XW3P"); });
    expect(regenerate).toHaveBeenCalledWith("tok", { password: "pw", code: "k7m2q9xw3p" });
    expect(t.r().page).toBe("codes");
    expect(t.r().codesOrigin).toBe("regen");
  });
  it("关闭：先系统二次确认（destructive）；取消不发请求；确认后关闭并 toast，回介绍页", async () => {
    const t = setup({}, on, false);
    await act(async () => { await t.r().refresh(); t.r().openAction("disable"); });
    await act(async () => { await t.r().submitAction("disable", "pw", "code", "123456"); });
    expect(t.api.disable).not.toHaveBeenCalled();
    expect(t.askConfirm.mock.calls[0][1]).toMatchObject({ danger: true });
    t.askConfirm.mockResolvedValue(true);
    await act(async () => { await t.r().submitAction("disable", "pw", "code", "123456"); });
    expect(t.api.disable).toHaveBeenCalledWith("tok", { password: "pw", code: "123456" });
    expect(t.r().page).toBe("intro");
    expect(t.setToast).toHaveBeenCalledWith("两步验证已关闭");
  });
  it("关闭时码错：留在页内报错，不关闭", async () => {
    const t = setup({ disable: vi.fn(async () => { throw err(200021); }) }, on);
    await act(async () => { await t.r().refresh(); t.r().openAction("disable"); await t.r().submitAction("disable", "pw", "code", "123456"); });
    expect(t.r().page).toBe("disable");
    expect(t.r().error).toBe("验证码不正确");
  });
  it("换账号（owner 变化）整体复位：上个账号的状态 / 恢复码不外泄", async () => {
    const api: TwoStepApiLike = { status: vi.fn(async () => on), setup: vi.fn(), enable: vi.fn(), disable: vi.fn(), regenerate: vi.fn(async () => CODES) };
    const hook = renderHook((p: { owner: string }) => useTwoStep({ owner: p.owner, token: () => "t", askConfirm: async () => true, setToast: () => {}, api }), { initialProps: { owner: "u1" } });
    await act(async () => { await hook.result.current.refresh(); hook.result.current.openAction("regen"); await hook.result.current.submitAction("regen", "p", "code", "123456"); });
    expect(hook.result.current.codes).toHaveLength(10);
    hook.rerender({ owner: "u2" });
    expect(hook.result.current.codes).toEqual([]);
    expect(hook.result.current.status).toBeNull();
  });
});
