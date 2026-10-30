// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServicesProvider, type AppServices } from "../../AppServicesContext";
import type { TwoStepState } from "../../useTwoStep";
import { TwoStepPanel } from "./TwoStepPanel";
import { PrivacySecurityPanel } from "./PrivacySecurityPanel";

afterEach(cleanup);
const noop = () => {};
function state(over: Partial<TwoStepState>): TwoStepState {
  return {
    status: { enabled: true, enabledAt: 1_700_000_000_000, recoveryRemaining: 8 }, page: "status", setup: null, codes: [], codesOrigin: "enable",
    saved: false, setSaved: noop, unsaved: false, busy: false, error: "", refresh: async () => {}, close: noop, startFlow: noop, cancelFlow: noop,
    openAction: noop, submitPassword: async () => {}, submitBind: async () => {}, submitAction: async () => {}, finishCodes: noop, leaveCodes: async () => true, ...over,
  };
}
const services = { setToast: vi.fn() } as unknown as AppServices;
const wrap = (ui: React.ReactElement) => render(<AppServicesProvider value={services}>{ui}</AppServicesProvider>);

describe("TwoStepPanel", () => {
  it("状态页：剩余 ≤2 → 橙色类 + footer；>2 无", () => {
    const low = wrap(<TwoStepPanel s={state({ status: { enabled: true, enabledAt: 1, recoveryRemaining: 2 } })} onClose={noop} />);
    expect(low.container.querySelector(".row-value.ts-low")).toBeTruthy();
    expect(low.getByText("恢复码快用完了，建议重新生成。")).toBeTruthy();
    low.unmount();
    const ok = wrap(<TwoStepPanel s={state({})} onClose={noop} />);
    expect(ok.container.querySelector(".ts-low")).toBeNull();
    expect(ok.container.querySelector(".settings-foot")).toBeNull();
  });
  it("状态页：点恢复码行 → 重新生成；点红字 → 关闭", () => {
    const openAction = vi.fn();
    const { getByText } = wrap(<TwoStepPanel s={state({ openAction })} onClose={noop} />);
    fireEvent.click(getByText("恢复码"));
    fireEvent.click(getByText("关闭两步验证"));
    expect(openAction.mock.calls).toEqual([["regen"], ["disable"]]);
  });
  it("介绍页：开启按钮进入流程；返回关闭面板", () => {
    const startFlow = vi.fn(), onClose = vi.fn();
    const { getByText, getByTitle } = wrap(<TwoStepPanel s={state({ page: "intro", status: { enabled: false, enabledAt: 0, recoveryRemaining: 0 } , startFlow })} onClose={onClose} />);
    fireEvent.click(getByText("开启两步验证"));
    expect(startFlow).toHaveBeenCalled();
    fireEvent.click(getByTitle("返回"));
    expect(onClose).toHaveBeenCalled();
  });
  it("恢复码页：未勾选时「完成」禁用；返回走 leaveCodes（拦截确认），不直接关", () => {
    const leaveCodes = vi.fn(async () => false), onClose = vi.fn();
    const codes = Array.from({ length: 10 }, (_, i) => `k${i}m2q-9xw3p`);
    const { getByText, getByTitle, container } = wrap(<TwoStepPanel s={state({ page: "codes", codes, leaveCodes })} onClose={onClose} />);
    expect((getByText("完成") as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelectorAll(".ts-codes span")).toHaveLength(10);
    fireEvent.click(getByTitle("返回"));
    expect(leaveCodes).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it("恢复码页：勾选后「完成」可点", () => {
    const finishCodes = vi.fn();
    const { getByText } = wrap(<TwoStepPanel s={state({ page: "codes", codes: ["a"], saved: true, finishCodes })} onClose={noop} />);
    fireEvent.click(getByText("完成"));
    expect(finishCodes).toHaveBeenCalled();
  });
  it("绑定页：二维码本地生成；手动密钥折叠，展开后 4 位一组", async () => {
    const setup = { secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/IM:x?secret=JBSWY3DPEHPK3PXP&issuer=IM", expiresIn: 1800 };
    const { container, getByText, queryByTestId, getByTestId } = wrap(<TwoStepPanel s={state({ page: "bind", setup })} onClose={noop} />);
    await waitFor(() => expect(container.querySelector(".ts-qr img")?.getAttribute("src")).toMatch(/^data:image\/png/));
    expect(queryByTestId("ts-secret")).toBeNull();
    fireEvent.click(getByText("无法扫码？手动输入密钥"));
    expect(getByTestId("ts-secret").textContent).toBe("JBSW Y3DP EHPK 3PXP");
  });
  it("绑定页：6 位满才可提交，错误红字出现且输入不清空", () => {
    const submitBind = vi.fn();
    const setup = { secret: "S", otpauthUri: "u", expiresIn: 1 };
    const { getByText, container } = wrap(<TwoStepPanel s={state({ page: "bind", setup, error: "验证码不正确，请检查认证器里的最新一个", submitBind })} onClose={noop} />);
    const btn = getByText("验证并开启") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const input = container.querySelector("input.ts-code6") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "123456" } });
    expect(btn.disabled).toBe(false);
    expect(getByText("验证码不正确，请检查认证器里的最新一个")).toBeTruthy();
    expect(input.value).toBe("123456");
    fireEvent.click(btn);
    expect(submitBind).toHaveBeenCalledWith("123456");
  });
  it("关闭页：切「改用恢复码」换成文本框；码就绪后以恢复码提交", () => {
    const submitAction = vi.fn();
    const { getByText, container } = wrap(<TwoStepPanel s={state({ page: "disable", submitAction })} onClose={noop} />);
    fireEvent.change(container.querySelector("input[type=password]")!, { target: { value: "Test1234" } });
    fireEvent.click(getByText("改用恢复码"));
    expect(container.querySelector("input.ts-recovery")).toBeTruthy();
    fireEvent.change(container.querySelector("input.ts-recovery")!, { target: { value: "K7M2Q-9XW3P" } });
    fireEvent.click(container.querySelector(".mini-btn.danger")!);
    expect(submitAction).toHaveBeenCalledWith("disable", "Test1234", "recovery", "K7M2Q-9XW3P");
  });
});

describe("PrivacySecurityPanel · 两步验证行", () => {
  const base = { blockedCount: 0, autoDeleteSec: null, visibility: null, onOpenVisibility: noop, onOpenBlocked: noop, onOpenChangePwd: noop, onOpenAutoDelete: noop, onOpenExport: noop, onOpenClearAll: noop, onComingSoon: noop, onBack: noop };
  it("活行：不灰置、右值随状态、点击进入而不是「即将上线」", () => {
    const onOpenTwoStep = vi.fn(), onComingSoon = vi.fn();
    const { getByText } = render(<PrivacySecurityPanel {...base} onComingSoon={onComingSoon} twoStepValue="开启" onOpenTwoStep={onOpenTwoStep} />);
    const row = getByText("两步验证").closest("button")!;
    expect(row.className).not.toContain("muted");
    expect(row.textContent).toContain("开启");
    fireEvent.click(row);
    expect(onOpenTwoStep).toHaveBeenCalled();
    expect(onComingSoon).not.toHaveBeenCalled();
  });
  it("加载前右值留空", () => {
    const { getByText } = render(<PrivacySecurityPanel {...base} onOpenTwoStep={noop} />);
    expect(getByText("两步验证").closest("button")!.querySelector(".row-value")).toBeNull();
  });
});
