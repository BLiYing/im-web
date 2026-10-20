// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDeleteAccount, useRestoreOffer } from "./useDeleteAccount";
import * as api from "./sdk/accountApi";

const err = (code: number, extra: object = {}) => Object.assign(new Error("boom"), { code }, extra);

describe("useDeleteAccount", () => {
  const setup = (run = vi.fn(async () => {}), ok = true) => {
    const askConfirm = vi.fn(async () => ok);
    const onDeleted = vi.fn();
    const h = renderHook(() => useDeleteAccount({ run, askConfirm, onDeleted }));
    return { h, run, askConfirm, onDeleted };
  };
  it("空密码不可提交（按钮置灰），填了才可", () => {
    const { h } = setup();
    expect(h.result.current.canSubmit).toBe(false);
    act(() => h.result.current.setPassword("pw"));
    expect(h.result.current.canSubmit).toBe(true);
  });
  it("二次确认取消 → 不调后端", async () => {
    const { h, run, askConfirm } = setup(undefined, false);
    act(() => h.result.current.setPassword("pw"));
    await act(() => h.result.current.submit());
    expect(askConfirm).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });
  it("确认后调后端并 onDeleted", async () => {
    const { h, run, onDeleted } = setup();
    act(() => h.result.current.setPassword("pw"));
    await act(() => h.result.current.submit());
    expect(run).toHaveBeenCalledWith("pw");
    expect(onDeleted).toHaveBeenCalledOnce();
  });
  it("群主阻断：记下群列表、按钮置灰、不 onDeleted", async () => {
    const groups = [{ conv_id: "g1", name: "产品组" }];
    const { h, onDeleted } = setup(vi.fn(async () => { throw err(100103, { ownedGroups: groups }); }));
    act(() => h.result.current.setPassword("pw"));
    await act(() => h.result.current.submit());
    expect(h.result.current.ownedGroups).toEqual(groups);
    expect(h.result.current.canSubmit).toBe(false);
    expect(onDeleted).not.toHaveBeenCalled();
  });
  it("确认弹窗打开期间重复提交 → 只弹一次", async () => {
    let release: (v: boolean) => void = () => {};
    const askConfirm = vi.fn((_m: string) => new Promise<boolean>((r) => { release = r; }));
    const run = vi.fn(async () => {});
    const h = renderHook(() => useDeleteAccount({ run, askConfirm, onDeleted: vi.fn() }));
    act(() => h.result.current.setPassword("pw"));
    let p1: Promise<void> = Promise.resolve(), p2: Promise<void> = Promise.resolve();
    act(() => { p1 = h.result.current.submit(); p2 = h.result.current.submit(); });
    expect(askConfirm).toHaveBeenCalledOnce();
    await act(async () => { release(false); await Promise.all([p1, p2]); });
  });
  it("密码错：显示错误文案，可重试", async () => {
    const { h } = setup(vi.fn(async () => { throw err(200002); }));
    act(() => h.result.current.setPassword("bad"));
    await act(() => h.result.current.submit());
    expect(h.result.current.error).toBe("boom");
    expect(h.result.current.canSubmit).toBe(true);
  });
});


describe("useRestoreOffer", () => {
  beforeEach(() => vi.restoreAllMocks());
  const pending = err(api.CODE_ACCOUNT_PENDING_DELETION, { deleteAt: 1_700_000_000 });
  it("非冷静期错误 → none，不弹窗", async () => {
    const askConfirm = vi.fn(async () => true);
    const { result } = renderHook(() => useRestoreOffer({ askConfirm, onError: vi.fn() }));
    expect(await result.current(err(200002), "u", "p")).toBe("none");
    expect(askConfirm).not.toHaveBeenCalled();
  });
  it("冷静期 + 无密码（免密路径）→ 本地化指引走 onError 并返回 handled，不弹窗不 restore", async () => {
    const spy = vi.spyOn(api, "restoreAccount").mockResolvedValue();
    const askConfirm = vi.fn(async () => true);
    const onError = vi.fn();
    const { result } = renderHook(() => useRestoreOffer({ askConfirm, onError }));
    expect(await result.current(pending, "u", "")).toBe("handled");
    expect(onError).toHaveBeenCalledWith(expect.not.stringContaining("pending deletion"));
    expect(onError.mock.calls[0][0]).toBeTruthy();
    expect(askConfirm).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
  it("冷静期 + 同意 → restore 后返回 restored", async () => {
    const spy = vi.spyOn(api, "restoreAccount").mockResolvedValue();
    const askConfirm = vi.fn(async () => true);
    const { result } = renderHook(() => useRestoreOffer({ askConfirm, onError: vi.fn() }));
    expect(await result.current(pending, "limo", "pw")).toBe("restored");
    expect(spy).toHaveBeenCalledWith("limo", "pw");
  });
  it("冷静期 + 取消 → handled 且不报错，不 restore", async () => {
    const spy = vi.spyOn(api, "restoreAccount").mockResolvedValue();
    const onError = vi.fn();
    const { result } = renderHook(() => useRestoreOffer({ askConfirm: async () => false, onError }));
    expect(await result.current(pending, "u", "p")).toBe("handled");
    expect(onError).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
  it("restore 失败 → onError 并返回 handled（调用方不再覆盖文案）", async () => {
    vi.spyOn(api, "restoreAccount").mockRejectedValue(new Error("密码错"));
    const onError = vi.fn();
    const { result } = renderHook(() => useRestoreOffer({ askConfirm: async () => true, onError }));
    expect(await result.current(pending, "u", "p")).toBe("handled");
    expect(onError).toHaveBeenCalledWith("密码错");
  });
  it("服务端没给 delete_at → 弹窗正文不含空日期", async () => {
    const askConfirm = vi.fn(async (_m: string) => false);
    const { result } = renderHook(() => useRestoreOffer({ askConfirm, onError: vi.fn() }));
    await result.current(err(api.CODE_ACCOUNT_PENDING_DELETION), "u", "p");
    expect(askConfirm.mock.calls[0][0]).toBe("该账号已申请注销");
  });
});
