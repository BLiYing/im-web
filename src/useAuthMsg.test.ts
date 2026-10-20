// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuthMsg } from "./useAuthMsg";

describe("useAuthMsg", () => {
  it("错误与通知互斥；清通知不动错误；登录开始 setAuthErr('') 清掉通知", () => {
    const { result } = renderHook(() => useAuthMsg());
    act(() => result.current.setAuthNotice("delete_account.done_hint"));
    expect(result.current.authNotice).toBe("delete_account.done_hint");
    act(() => result.current.clearAuthNotice());
    expect(result.current.authNotice).toBe("");
    act(() => result.current.setAuthNotice("k"));
    act(() => result.current.setAuthErr("x"));
    expect(result.current.authNotice).toBe(""); expect(result.current.authErr).toBe("x");
    act(() => result.current.setAuthNotice("k"));
    act(() => result.current.setAuthErr(""));
    expect(result.current.authNotice).toBe("");
  });
});
