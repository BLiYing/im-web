// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownedGroupsLine, useDeleteAccount, useRestoreOffer } from "./useDeleteAccount";
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
  it("密码错：显示错误文案，可重试", async () => {
    const { h } = setup(vi.fn(async () => { throw err(200002); }));
    act(() => h.result.current.setPassword("bad"));
    await act(() => h.result.current.submit());
    expect(h.result.current.error).toBe("boom");
    expect(h.result.current.canSubmit).toBe(true);
  });
});

describe("ownedGroupsLine", () => {
  it("≤3 个全列；超出折成「等 N 个」", () => {
    const g = (n: string) => ({ conv_id: n, name: n });
    expect(ownedGroupsLine([g("A"), g("B")])).toBe("A · B");
    expect(ownedGroupsLine([g("A"), g("B"), g("C"), g("D"), g("E")])).toBe("A · B · C · 等 2 个");
  });
});

describe("useRestoreOffer", () => {
  beforeEach(() => vi.restoreAllMocks());
  const pending = err(api.CODE_ACCOUNT_PENDING_DELETION, { deleteAt: 1_700_000_000 });
  it("非冷静期错误 → false，不弹窗", async () => {
    const askConfirm = vi.fn(async () => true);
    const { result } = renderHook(() => useRestoreOffer({ askConfirm, onError: vi.fn() }));
    expect(await result.current(err(200002), "u", "p")).toBe(false);
    expect(askConfirm).not.toHaveBeenCalled();
  });
  it("冷静期 + 同意 → restore 后返回 true", async () => {
    const spy = vi.spyOn(api, "restoreAccount").mockResolvedValue();
    const askConfirm = vi.fn(async () => true);
    const { result } = renderHook(() => useRestoreOffer({ askConfirm, onError: vi.fn() }));
    expect(await result.current(pending, "limo", "pw")).toBe(true);
    expect(spy).toHaveBeenCalledWith("limo", "pw");
  });
  it("冷静期 + 取消 → false，不 restore", async () => {
    const spy = vi.spyOn(api, "restoreAccount").mockResolvedValue();
    const { result } = renderHook(() => useRestoreOffer({ askConfirm: async () => false, onError: vi.fn() }));
    expect(await result.current(pending, "u", "p")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
  it("restore 失败 → onError 并返回 false", async () => {
    vi.spyOn(api, "restoreAccount").mockRejectedValue(new Error("密码错"));
    const onError = vi.fn();
    const { result } = renderHook(() => useRestoreOffer({ askConfirm: async () => true, onError }));
    expect(await result.current(pending, "u", "p")).toBe(false);
    expect(onError).toHaveBeenCalledWith("密码错");
  });
});
