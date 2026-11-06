// @vitest-environment jsdom
// 关于我们：三条链接 + 在线客服（有地址才显示）+ 版本、点击回调、版本行无 chevron 有右值。
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AboutPanel } from "./AboutPanel";
import { setPref } from "../../i18n";

afterEach(() => { cleanup(); setPref("zh-Hans"); });

const mount = (over: Partial<Parameters<typeof AboutPanel>[0]> = {}) =>
  render(<AboutPanel version="0.1.0 (abc)" showCustomerService onOpen={vi.fn()} onCopyVersion={vi.fn()} onBack={vi.fn()} {...over} />);

describe("AboutPanel", () => {
  it("五行文案、版本右值；版本行没有 chevron，链接行有", () => {
    const { getByText, container } = mount();
    for (const s of ["关于我们", "隐私政策", "服务条款", "技术支持", "在线客服", "版本", "0.1.0 (abc)"]) expect(getByText(s), s).toBeTruthy();
    const rows = container.querySelectorAll(".settings-row");
    expect(rows.length).toBe(5);
    expect(rows[3].querySelector(".row-chevron")).toBeTruthy();
    expect(rows[4].querySelector(".row-chevron")).toBeNull();
  });

  it("没有客服地址时不渲染「在线客服」行", () => {
    const { queryByText, container } = mount({ showCustomerService: false });
    expect(queryByText("在线客服")).toBeNull();
    expect(container.querySelectorAll(".settings-row").length).toBe(4);
  });

  it("点四条链接回调对应 kind；点版本回调复制", () => {
    const onOpen = vi.fn(); const onCopy = vi.fn();
    const { getByText } = mount({ onOpen, onCopyVersion: onCopy });
    fireEvent.click(getByText("隐私政策")); fireEvent.click(getByText("服务条款")); fireEvent.click(getByText("技术支持")); fireEvent.click(getByText("在线客服"));
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual(["privacy", "terms", "support", "customerService"]);
    fireEvent.click(getByText("版本"));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
