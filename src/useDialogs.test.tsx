// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useDialogs } from "./useDialogs";

afterEach(cleanup);

describe("useDialogs", () => {
  it("askConfirm 打开弹窗并带默认文案；resolve(true) 后 Promise 兑现", async () => {
    const { result } = renderHook(() => useDialogs());
    expect(result.current.confirmDlg).toBeNull();

    let p!: Promise<boolean>;
    act(() => { p = result.current.askConfirm("确定吗？"); });
    expect(result.current.confirmDlg).toMatchObject({ message: "确定吗？", okText: "确定", cancelText: "取消", danger: false });

    // 模拟点「确定」：resolve(true) + 关闭（与 App 弹窗 JSX 的 onClick 一致）
    act(() => { result.current.confirmDlg!.resolve(true); result.current.setConfirmDlg(null); });
    await expect(p).resolves.toBe(true);
    expect(result.current.confirmDlg).toBeNull();
  });

  it("askConfirm 自定义 okText/danger 透传", () => {
    const { result } = renderHook(() => useDialogs());
    act(() => { void result.current.askConfirm("退出？", { okText: "退出", danger: true }); });
    expect(result.current.confirmDlg).toMatchObject({ okText: "退出", danger: true });
  });

  it("askPrompt 默认值/占位/上限透传；取消 resolve(null)", async () => {
    const { result } = renderHook(() => useDialogs());
    let p!: Promise<string | null>;
    act(() => { p = result.current.askPrompt("群名", "旧名", { placeholder: "输入", maxLength: 30 }); });
    expect(result.current.promptDlg).toMatchObject({ title: "群名", value: "旧名", placeholder: "输入", maxLength: 30 });

    act(() => { result.current.promptDlg!.resolve(null); result.current.setPromptDlg(null); });
    await expect(p).resolves.toBeNull();
  });

  it("askPrompt 编辑后确定 resolve 当前值（value 随 setPromptDlg 更新）", async () => {
    const { result } = renderHook(() => useDialogs());
    let p!: Promise<string | null>;
    act(() => { p = result.current.askPrompt("备注", ""); });
    act(() => { result.current.setPromptDlg({ ...result.current.promptDlg!, value: "新备注" }); });
    act(() => { result.current.promptDlg!.resolve(result.current.promptDlg!.value); result.current.setPromptDlg(null); });
    await expect(p).resolves.toBe("新备注");
  });
});
