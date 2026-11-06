// @vitest-environment jsdom
// 登录页隐式同意提示：整句可读、两段可点链接各打开对应法务页（带当前语言）。
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openExternal = vi.fn();
vi.mock("../platform", () => ({ platform: () => ({ openExternal }) }));
const fetchAboutLinks = vi.fn();
vi.mock("../sdk/aboutLinksApi", () => ({ fetchAboutLinks: (...a: unknown[]) => fetchAboutLinks(...a) }));

import { LoginAgreeFooter } from "./LoginAgreeFooter";
import { setPref } from "../i18n";

beforeEach(() => { setPref("zh-Hans"); fetchAboutLinks.mockReset(); fetchAboutLinks.mockRejectedValue(new Error("offline")); });
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

  it("拉取失败（离线 / 老服务端）：退回内置路径，不报错", async () => {
    const { getByText } = render(<LoginAgreeFooter />);
    await waitFor(() => expect(fetchAboutLinks).toHaveBeenCalledTimes(1));
    expect(fetchAboutLinks).toHaveBeenCalledWith(""); // 登录页匿名拉取
    fireEvent.click(getByText("隐私政策"));
    expect(openExternal).toHaveBeenCalledWith("/legal/privacy?lang=zh-Hans");
  });

  it("后台配了外部链接：原样打开（不追加 ?lang=）；仍是相对路径的那项继续带语言", async () => {
    fetchAboutLinks.mockResolvedValue({
      privacy_url: "https://corp.example.com/privacy?v=2", terms_url: "/legal/terms",
      support_url: "/support", customer_service_url: "",
    });
    const { getByText } = render(<LoginAgreeFooter />);
    await waitFor(() => {
      fireEvent.click(getByText("隐私政策"));
      expect(openExternal).toHaveBeenCalledWith("https://corp.example.com/privacy?v=2");
    });
    fireEvent.click(getByText("服务条款"));
    expect(openExternal).toHaveBeenLastCalledWith("/legal/terms?lang=zh-Hans");
  });
});
