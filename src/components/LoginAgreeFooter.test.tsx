// @vitest-environment jsdom
// 登录页隐式同意提示：整句可读、两段可点链接各打开对应法务页（带当前语言）。
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openExternal = vi.fn();
vi.mock("../platform", () => ({ platform: () => ({ openExternal }) }));

import { LoginAgreeFooter } from "./LoginAgreeFooter";
import { setPref } from "../i18n";

beforeEach(() => setPref("zh-Hans"));
afterEach(() => { cleanup(); setPref("zh-Hans"); openExternal.mockClear(); });

describe("LoginAgreeFooter", () => {
  it("整句拼接可读，两段为独立链接（无勾选框）", () => {
    const { getByText, container } = render(<LoginAgreeFooter />);
    expect(container.querySelector(".login-agree")?.textContent).toBe("继续即表示同意《服务条款》和《隐私政策》");
    expect(getByText("服务条款").tagName).toBe("BUTTON");
    expect(getByText("隐私政策").tagName).toBe("BUTTON");
    expect(container.querySelector("input[type=checkbox]")).toBeNull();
  });

  it("点两段链接各打开对应法务页（带语言）", () => {
    const { getByText } = render(<LoginAgreeFooter />);
    fireEvent.click(getByText("服务条款"));
    fireEvent.click(getByText("隐私政策"));
    expect(openExternal.mock.calls.map((c) => c[0])).toEqual(["/legal/terms?lang=zh-Hans", "/legal/privacy?lang=zh-Hans"]);
  });

  it("英文语言下文案与链接标签切换", () => {
    setPref("en");
    const { getByText, container } = render(<LoginAgreeFooter />);
    expect(container.querySelector(".login-agree")?.textContent).toBe("By continuing you agree to the Terms of Service and Privacy Policy");
    fireEvent.click(getByText("Terms of Service"));
    expect(openExternal).toHaveBeenCalledWith("/legal/terms?lang=en");
  });
});
