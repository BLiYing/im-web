// 语言偏好 → 宿主同步：启动推一次、每次切换再推、拆除后不再推。
import { afterEach, describe, expect, it, vi } from "vitest";

const setLanguage = vi.fn(async (_p: string) => {});
vi.mock("./platform", () => ({ platform: () => ({ setLanguage }) }));

import { installLanguageSync } from "./i18nDesktopSync";
import { setPref } from "./i18n";

afterEach(() => { setPref("zh-Hans"); setLanguage.mockClear(); });

describe("installLanguageSync", () => {
  it("启动推当前偏好；切换再推；拆除后不推", () => {
    const off = installLanguageSync();
    expect(setLanguage).toHaveBeenLastCalledWith("zh-Hans");
    setPref("en");
    expect(setLanguage).toHaveBeenLastCalledWith("en");
    setPref("system");
    expect(setLanguage).toHaveBeenLastCalledWith("system");
    const n = setLanguage.mock.calls.length;
    off();
    setPref("en");
    expect(setLanguage.mock.calls.length).toBe(n);
  });

  it("宿主推送失败不抛（页面语言不受影响）", async () => {
    setLanguage.mockRejectedValueOnce(new Error("bridge down"));
    expect(() => installLanguageSync()()).not.toThrow();
    await Promise.resolve();
  });
});
