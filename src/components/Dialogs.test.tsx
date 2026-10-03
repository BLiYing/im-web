// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptDialog } from "./Dialogs";
import type { PromptDlg } from "../useDialogs";

// 群备注 / 我在本群的昵称弹窗：说明单独一行 + n/max 计数（对齐 iOS / Android）。
const dlg = (over: Partial<PromptDlg> = {}): PromptDlg => ({
  title: "群备注", value: "abc", placeholder: "群名", okText: "保存", maxLength: 30, resolve: vi.fn(), ...over,
});

afterEach(cleanup);

describe("PromptDialog 说明行与字数计数", () => {
  it("带 hint → 标题下独立一行；计数显示 当前/上限", () => {
    const { getByText } = render(<PromptDialog dlg={dlg({ hint: "仅你自己可见" })} set={vi.fn()} />);
    expect(getByText("仅你自己可见")).toBeTruthy();
    expect(getByText("3/30")).toBeTruthy();
  });
  it("不带 hint → 不渲染说明行", () => {
    const { container } = render(<PromptDialog dlg={dlg()} set={vi.fn()} />);
    expect(container.querySelector(".modal-hint")).toBeNull();
  });
});
