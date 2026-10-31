// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailLoginPanel } from "./EmailLoginPanel";
import type { EmailLoginState } from "../../useEmailLogin";

const base = (over: Partial<EmailLoginState> = {}): EmailLoginState => ({
  info: { available: true, bound: false, email: "", verifiedAt: 0 }, page: "intro", email: "", setEmail: vi.fn(), sentTo: "a@b.com",
  busy: false, error: "", codeTick: 0, resendTick: 0, resendAt: 0, refresh: vi.fn(async () => {}), reset: vi.fn(),
  start: vi.fn(), back: vi.fn(), sendCode: vi.fn(async () => {}), resend: vi.fn(async () => {}), verify: vi.fn(async () => {}),
  openUnbind: vi.fn(), unbind: vi.fn(async () => {}), ...over,
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("EmailLoginPanel", () => {
  it("available:false：主按钮置灰且显示未启用说明", () => {
    render(<EmailLoginPanel s={base({ info: { available: false, bound: false, email: "", verifiedAt: 0 } })} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "绑定邮箱" })).toBeDisabled();
    expect(screen.getByText("邮件服务暂未启用")).toBeInTheDocument();
  });

  it("邮箱框属性：type=email、noValidate、autocomplete=email、autocapitalize=off、spellcheck=false；点发送带上输入值", () => {
    const s = base({ page: "form", email: "a@b" });
    render(<EmailLoginPanel s={s} onClose={vi.fn()} />);
    const email = screen.getByLabelText("邮箱地址") as HTMLInputElement;
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toHaveAttribute("autocapitalize", "off");
    expect(email).toHaveAttribute("spellcheck", "false");
    expect(email.form?.noValidate).toBe(true);
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
    expect(s.sendCode).toHaveBeenCalledWith("a@b", "pw");
  });

  it("输入法组词中按 Enter 不提交；非组词 Enter 才提交", () => {
    const s = base({ page: "form", email: "a@b.com" });
    render(<EmailLoginPanel s={s} onClose={vi.fn()} />);
    const pw = screen.getByLabelText("当前密码");
    fireEvent.change(pw, { target: { value: "pw" } });
    fireEvent.keyDown(pw, { key: "Enter", isComposing: true });
    expect(s.sendCode).not.toHaveBeenCalled();
    fireEvent.keyDown(pw, { key: "Enter" });
    expect(s.sendCode).toHaveBeenCalledTimes(1);
  });

  it("重发倒计时：显示 59s 灰置，走完恢复可点；卸载后定时器全部清除", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const idle = render(<EmailLoginPanel s={base({ page: "code", resendAt: 0 })} onClose={vi.fn()} />);
    idle.unmount();
    const timers0 = vi.getTimerCount(); // 基线：同一页无倒计时时 React/测试库自带的残留，与 setInterval 无关
    const s = base({ page: "code", resendAt: 1_000_000 + 3000 });
    const { unmount } = render(<EmailLoginPanel s={s} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "重新发送（3s）" })).toBeDisabled();
    act(() => { vi.advanceTimersByTime(3000); });
    const btn = screen.getByRole("button", { name: "重新发送" });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(s.resend).toHaveBeenCalled();
    cleanup();
    const r2 = render(<EmailLoginPanel s={base({ page: "code", resendAt: Date.now() + 30_000 })} onClose={vi.fn()} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    r2.unmount(); unmount();
    expect(vi.getTimerCount()).toBe(timers0);
  });

  it("验证码页：输满 6 位自动提交", () => {
    const s = base({ page: "code" });
    render(<EmailLoginPanel s={s} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("6 位验证码"), { target: { value: "123456" } });
    expect(s.verify).toHaveBeenCalledWith("123456");
  });
});
