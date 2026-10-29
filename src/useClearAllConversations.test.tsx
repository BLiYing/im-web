// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useClearAllConversations } from "./useClearAllConversations";

const ok = { cleared: 3, items: [{ convId: "a", clearedAt: 5 }] };
function setup(over: Partial<Parameters<typeof useClearAllConversations>[0]> = {}) {
  const m = {
    run: vi.fn(async () => ok),
    apply: vi.fn(async (_res: typeof ok) => {}),
    askConfirm: vi.fn(async (_msg: string, _opts?: { title?: string; okText?: string; danger?: boolean }) => true),
    onDone: vi.fn((_n: number) => {}),
  };
  const d = { count: 12, ...m, ...over };
  return { d, m, hook: renderHook(() => useClearAllConversations(d)) };
}

describe("useClearAllConversations", () => {
  it("确认弹窗文案带打开时的会话数 N，确认钮 destructive", async () => {
    const t = setup();
    await act(async () => { await t.hook.result.current.submit(); });
    const [msg, opts] = t.m.askConfirm.mock.calls[0];
    expect(msg).toBe("将清除全部 12 个会话的聊天记录，所有设备同步生效，此操作无法撤销。");
    expect(opts).toMatchObject({ title: "清除所有对话？", okText: "清除", danger: true });
  });
  it("取消：不发请求、不动本机", async () => {
    const t = setup({ askConfirm: vi.fn(async () => false) });
    await act(async () => { await t.hook.result.current.submit(); });
    expect(t.m.run).not.toHaveBeenCalled();
    expect(t.m.apply).not.toHaveBeenCalled();
    expect(t.m.onDone).not.toHaveBeenCalled();
  });
  it("成功：先 apply 本机清除，再 onDone(服务端 cleared)", async () => {
    const t = setup();
    await act(async () => { await t.hook.result.current.submit(); });
    expect(t.m.apply).toHaveBeenCalledWith(ok);
    expect(t.m.onDone).toHaveBeenCalledWith(3);
    expect(t.m.apply.mock.invocationCallOrder[0]).toBeLessThan(t.m.onDone.mock.invocationCallOrder[0]);
    expect(t.hook.result.current.busy).toBe(false);
  });
  it("失败：红字原因、按钮恢复、本机不做任何变更（不调 apply / onDone）", async () => {
    const t = setup({ run: vi.fn(async () => { throw new Error("操作过于频繁，请稍后再试"); }) });
    await act(async () => { await t.hook.result.current.submit(); });
    expect(t.hook.result.current.error).toBe("操作过于频繁，请稍后再试");
    expect(t.hook.result.current.busy).toBe(false);
    expect(t.m.apply).not.toHaveBeenCalled();
    expect(t.m.onDone).not.toHaveBeenCalled();
  });
  it("失败后重试成功会清掉旧错误", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(ok);
    const t = setup({ run });
    await act(async () => { await t.hook.result.current.submit(); });
    expect(t.hook.result.current.error).toBe("x");
    await act(async () => { await t.hook.result.current.submit(); });
    expect(t.hook.result.current.error).toBe("");
    expect(t.m.apply).toHaveBeenCalledTimes(1);
  });
  it("请求中用户已返回（卸载）：本机照清，但不再回调 onDone（不在隐私页弹 toast）", async () => {
    let release!: (v: typeof ok) => void;
    const t = setup({ run: vi.fn(() => new Promise<typeof ok>((r) => { release = r; })) });
    let p!: Promise<void>;
    await act(async () => { p = t.hook.result.current.submit(); });
    t.hook.unmount();
    await act(async () => { release(ok); await p; });
    expect(t.m.apply).toHaveBeenCalledWith(ok);
    expect(t.m.onDone).not.toHaveBeenCalled();
  });
});
