// @vitest-environment jsdom
// 关于我们：四行（三条链接 + 版本）、点击回调、版本行无 chevron 有右值。
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AboutPanel } from "./AboutPanel";
import { LEGAL_PATH } from "../../aboutLinks";
import { setPref } from "../../i18n";

afterEach(() => { cleanup(); setPref("zh-Hans"); });

describe("AboutPanel", () => {
  it("四行文案、版本右值；版本行没有 chevron，链接行有", () => {
    const { getByText, container } = render(<AboutPanel version="0.1.0 (abc)" onOpen={vi.fn()} onCopyVersion={vi.fn()} onBack={vi.fn()} />);
    for (const s of ["关于我们", "隐私政策", "服务条款", "技术支持", "版本", "0.1.0 (abc)"]) expect(getByText(s), s).toBeTruthy();
    const rows = container.querySelectorAll(".settings-row");
    expect(rows.length).toBe(4);
    expect(rows[0].querySelector(".row-chevron")).toBeTruthy();
    expect(rows[3].querySelector(".row-chevron")).toBeNull();
  });

  it("点三条链接回调对应路径；点版本回调复制", () => {
    const onOpen = vi.fn(); const onCopy = vi.fn();
    const { getByText } = render(<AboutPanel version="v" onOpen={onOpen} onCopyVersion={onCopy} onBack={vi.fn()} />);
    fireEvent.click(getByText("隐私政策")); fireEvent.click(getByText("服务条款")); fireEvent.click(getByText("技术支持"));
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual([LEGAL_PATH.privacy, LEGAL_PATH.terms, LEGAL_PATH.support]);
    fireEvent.click(getByText("版本"));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
