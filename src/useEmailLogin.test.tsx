// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEmailLogin, type EmailApiLike } from "./useEmailLogin";
import { t } from "./i18n";

const err = (code: number, data?: unknown) => Object.assign(new Error("x"), { code, data });
const UNBOUND = { available: true, bound: false, email: "", verifiedAt: 0 };

function setup(over: Partial<EmailApiLike> = {}, initial = UNBOUND, confirm = true) {
  let info = initial;
  const api: EmailApiLike = {
    info: vi.fn(async () => info),
    send: vi.fn(async () => ({ expiresIn: 600, resendAfter: 60 })),
    verify: vi.fn(async (_t, p) => { info = { available: true, bound: true, email: p.email, verifiedAt: 5 }; return { email: p.email, verifiedAt: 5000 }; }),
    unbind: vi.fn(async () => { info = UNBOUND; }),
    ...over,
  };
  const askConfirm = vi.fn(async (_m: string, _o?: object) => confirm);
  const setToast = vi.fn();
  let clock = 1_000_000;
  const hook = renderHook(() => useEmailLogin({ owner: "u1", token: () => "tok", askConfirm, setToast, api, now: () => clock }));
  return { api, askConfirm, setToast, hook, r: () => hook.result.current, tick: (ms: number) => { clock += ms; } };
}

describe("useEmailLogin · 绑定", () => {
  it("未绑定：loading → intro；已绑定 → bound；加载失败 → loadFailed，可重试", async () => {
    const a = setup();
    expect(a.r().page).toBe("loading");
    await act(async () => { await a.r().refresh(); });
    expect(a.r().page).toBe("intro");
    const b = setup({}, { available: true, bound: true, email: "a@b.com", verifiedAt: 1 });
    await act(async () => { await b.r().refresh(); });
    expect(b.r().page).toBe("bound");
    const c = setup({ info: vi.fn().mockRejectedValueOnce(new Error("net")).mockResolvedValue(UNBOUND) });
    await act(async () => { await c.r().refresh(); });
    expect(c.r().page).toBe("loadFailed");
    await act(async () => { await c.r().refresh(); });
    expect(c.r().page).toBe("intro");
  });

  it("格式预检不过：不发请求、红字 email.err.invalid、仍在表单页", async () => {
    const a = setup();
    await act(async () => { await a.r().refresh(); a.r().start(); });
    await act(async () => { await a.r().sendCode("abc", "pw"); });
    expect(a.api.send).not.toHaveBeenCalled();
    expect(a.r().error).toBe(t("email.err.invalid"));
    expect(a.r().page).toBe("form");
  });

  it("发送成功：进验证码页，倒计时 60s；lang 与 trim 后的邮箱随请求发出", async () => {
    const a = setup();
    await act(async () => { await a.r().refresh(); a.r().start(); });
    await act(async () => { await a.r().sendCode("  a@b.com ", "pw"); });
    expect(a.api.send).toHaveBeenCalledWith("tok", { email: "a@b.com", password: "pw", lang: expect.stringMatching(/^(en|zh-Hans)$/) });
    expect(a.r().page).toBe("code");
    expect(a.r().sentTo).toBe("a@b.com");
    expect(a.r().resendAt).toBe(1_000_000 + 60_000);
  });

  it("发送失败：停在表单页给红字，输入（邮箱）保留；限流带秒数", async () => {
    const a = setup({ send: vi.fn().mockRejectedValueOnce(err(200002)).mockRejectedValueOnce(err(100002, { retry_after_sec: 30 })) });
    await act(async () => { await a.r().refresh(); a.r().start(); a.r().setEmail("a@b.com"); });
    await act(async () => { await a.r().sendCode("a@b.com", "bad"); });
    expect(a.r().page).toBe("form");
    expect(a.r().error).toBe(t("email.err.password"));
    expect(a.r().email).toBe("a@b.com");
    await act(async () => { await a.r().sendCode("a@b.com", "pw"); });
    expect(a.r().error).toBe(t("email.err.too_frequent_secs", { n: 30 }));
  });

  it("验证码错：错码提示 + codeTick 递增 + 剩余次数；仍在验证码页", async () => {
    const a = setup({ verify: vi.fn().mockRejectedValue(err(200032, { attempts_left: 2 })) });
    await act(async () => { await a.r().refresh(); a.r().start(); await a.r().sendCode("a@b.com", "pw"); });
    const tick = a.r().codeTick;
    await act(async () => { await a.r().verify("123456"); });
    expect(a.r().page).toBe("code");
    expect(a.r().error).toBe(t("email.code.wrong_left", { n: 2 }));
    expect(a.r().codeTick).toBe(tick + 1);
  });

  it("验证码过期：红字 + 焦点回重发 + 倒计时按 retry_after_sec 重建", async () => {
    const a = setup({ verify: vi.fn().mockRejectedValue(err(200033, { retry_after_sec: 20 })) });
    await act(async () => { await a.r().refresh(); a.r().start(); await a.r().sendCode("a@b.com", "pw"); });
    const rt = a.r().resendTick;
    await act(async () => { await a.r().verify("123456"); });
    expect(a.r().error).toBe(t("email.code.expired"));
    expect(a.r().resendTick).toBe(rt + 1);
    expect(a.r().resendAt).toBe(1_000_000 + 20_000);
  });

  it("验证成功：回已绑定页 + toast，邮箱表单复位", async () => {
    const a = setup();
    await act(async () => { await a.r().refresh(); a.r().start(); a.r().setEmail("a@b.com"); await a.r().sendCode("a@b.com", "pw"); });
    await act(async () => { await a.r().verify("123456"); });
    expect(a.r().page).toBe("bound");
    expect(a.r().info?.email).toBe("a@b.com");
    expect(a.setToast).toHaveBeenCalledWith(t("email.toast.bound"));
    expect(a.r().email).toBe("");
  });

  it("重发：复用内存里的密码，成功后倒计时重置；更换邮箱（back）回表单保留邮箱", async () => {
    const a = setup();
    await act(async () => { await a.r().refresh(); a.r().start(); a.r().setEmail("a@b.com"); await a.r().sendCode("a@b.com", "pw"); });
    a.tick(61_000);
    await act(async () => { await a.r().resend(); });
    expect(a.api.send).toHaveBeenLastCalledWith("tok", expect.objectContaining({ email: "a@b.com", password: "pw" }));
    expect(a.r().resendAt).toBe(1_061_000 + 60_000);
    act(() => a.r().back());
    expect(a.r().page).toBe("form");
    expect(a.r().email).toBe("a@b.com");
    await act(async () => { await a.r().resend(); }); // 密码已清：不再发请求
    expect(a.api.send).toHaveBeenCalledTimes(2);
  });
});

describe("useEmailLogin · 竞态", () => {
  const deferred = <T,>() => { let res!: (v: T) => void; const p = new Promise<T>((r) => { res = r; }); return { p, res }; };

  it("发码在途时关面板（reset）：迟到的回包不再切到验证码页、不留密码", async () => {
    const d = deferred<{ expiresIn: number; resendAfter: number }>();
    const a = setup({ send: vi.fn(() => d.p) });
    await act(async () => { await a.r().refresh(); a.r().start(); });
    let pending!: Promise<void>;
    act(() => { pending = a.r().sendCode("a@b.com", "pw"); });
    expect(a.r().busy).toBe(true);
    act(() => a.r().reset());
    expect(a.r().busy).toBe(false);
    await act(async () => { d.res({ expiresIn: 600, resendAfter: 60 }); await pending; });
    expect(a.r().page).toBe("intro");
    expect(a.r().sentTo).toBe("");
    await act(async () => { await a.r().resend(); }); // 密码 ref 已清：不会带着旧密码再发
    expect(a.api.send).toHaveBeenCalledTimes(1);
  });

  it("发码在途时点返回（back）：回包被丢弃", async () => {
    const d = deferred<{ expiresIn: number; resendAfter: number }>();
    const a = setup({ send: vi.fn(() => d.p) });
    await act(async () => { await a.r().refresh(); a.r().start(); });
    let pending!: Promise<void>;
    act(() => { pending = a.r().sendCode("a@b.com", "pw"); });
    act(() => a.r().back());
    await act(async () => { d.res({ expiresIn: 600, resendAfter: 60 }); await pending; });
    expect(a.r().page).toBe("intro");
  });

  it("重复点击：在途时再次发送被拦，只发一次请求", async () => {
    const d = deferred<{ expiresIn: number; resendAfter: number }>();
    const a = setup({ send: vi.fn(() => d.p) });
    await act(async () => { await a.r().refresh(); a.r().start(); });
    let p1!: Promise<void>, p2!: Promise<void>;
    act(() => { p1 = a.r().sendCode("a@b.com", "pw"); p2 = a.r().sendCode("a@b.com", "pw"); });
    await act(async () => { d.res({ expiresIn: 600, resendAfter: 60 }); await Promise.all([p1, p2]); });
    expect(a.api.send).toHaveBeenCalledTimes(1);
  });

  it("验证在途时关面板：服务端已绑定的回包丢弃页面状态，但重取一次信息", async () => {
    const d = deferred<{ email: string; verifiedAt: number }>();
    const a = setup({ verify: vi.fn(() => d.p) });
    await act(async () => { await a.r().refresh(); a.r().start(); await a.r().sendCode("a@b.com", "pw"); });
    let pending!: Promise<void>;
    act(() => { pending = a.r().verify("123456"); });
    act(() => a.r().reset());
    const infoCalls = (a.api.info as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => { d.res({ email: "a@b.com", verifiedAt: 1 }); await pending; });
    expect(a.setToast).not.toHaveBeenCalled();
    expect((a.api.info as ReturnType<typeof vi.fn>).mock.calls.length).toBe(infoCalls + 1);
  });

  it("解绑确认弹窗期间关面板：不再发解绑请求", async () => {
    const d = deferred<boolean>();
    const a = setup({}, { available: true, bound: true, email: "a@b.com", verifiedAt: 1 });
    (a.askConfirm as ReturnType<typeof vi.fn>).mockImplementation(() => d.p);
    await act(async () => { await a.r().refresh(); a.r().openUnbind(); });
    let pending!: Promise<void>;
    act(() => { pending = a.r().unbind("pw"); });
    act(() => a.r().reset());
    await act(async () => { d.res(true); await pending; });
    expect(a.api.unbind).not.toHaveBeenCalled();
  });
});

describe("useEmailLogin · 解绑", () => {
  const BOUND = { available: true, bound: true, email: "a@b.com", verifiedAt: 1 };
  it("确认后解绑：回说明页 + toast；取消确认不发请求", async () => {
    const no = setup({}, BOUND, false);
    await act(async () => { await no.r().refresh(); no.r().openUnbind(); });
    await act(async () => { await no.r().unbind("pw"); });
    expect(no.api.unbind).not.toHaveBeenCalled();
    expect(no.r().page).toBe("unbind");
    const ok = setup({}, BOUND, true);
    await act(async () => { await ok.r().refresh(); ok.r().openUnbind(); });
    await act(async () => { await ok.r().unbind("pw"); });
    expect(ok.askConfirm).toHaveBeenCalledWith(t("email.unbind.body"), expect.objectContaining({ danger: true }));
    expect(ok.r().page).toBe("intro");
    expect(ok.setToast).toHaveBeenCalledWith(t("email.toast.unbound"));
  });
  it("密码错：停在解绑页给红字", async () => {
    const a = setup({ unbind: vi.fn().mockRejectedValue(err(200002)) }, BOUND);
    await act(async () => { await a.r().refresh(); a.r().openUnbind(); });
    await act(async () => { await a.r().unbind("bad"); });
    expect(a.r().page).toBe("unbind");
    expect(a.r().error).toBe(t("email.err.password"));
  });
});
