import { afterEach, describe, expect, it } from "vitest";
import { format, getLang, getPref, resolveLanguage, setPref, subscribe, t, translate } from "./index";

afterEach(() => setPref("zh-Hans"));

describe("resolveLanguage（跟随系统）", () => {
  it("取首个被支持的系统语言", () => {
    expect(resolveLanguage("system", ["fr-FR", "en-US"])).toBe("en");
    expect(resolveLanguage("system", ["zh-CN", "en"])).toBe("zh-Hans");
  });
  it("繁体归入简体；都不支持回落 en（不是中文）", () => {
    expect(resolveLanguage("system", ["zh-Hant-TW"])).toBe("zh-Hans");
    expect(resolveLanguage("system", ["fr", "de"])).toBe("en");
    expect(resolveLanguage("system", [])).toBe("en");
  });
  it("显式选择不受系统语言影响", () => {
    expect(resolveLanguage("zh-Hans", ["en-US"])).toBe("zh-Hans");
    expect(resolveLanguage("en", ["zh-CN"])).toBe("en");
  });
});

describe("format", () => {
  it("具名占位符、{{ }} 字面量、缺参保留", () => {
    expect(format("Hi {name}! {{x}}", { name: "Bob" })).toBe("Hi Bob! {x}");
    expect(format("Hi {name}")).toBe("Hi {name}");
    expect(format("{n}%", { n: 5 })).toBe("5%");
  });
});

describe("translate / t", () => {
  it("两种语言取到各自的值，占位符生效", () => {
    expect(translate("zh-Hans", "common.coming_soon", { name: "通知" })).toBe("通知（开发中）");
    expect(translate("en", "common.coming_soon", { name: "Notifications" })).toBe("Notifications (coming soon)");
  });
  it("缺键返回键本身（不抛）", () => {
    expect(translate("en", "no.such.key")).toBe("no.such.key");
  });
  it("t() 跟随 setPref 切换并落 localStorage / html lang / 通知订阅者", () => {
    let hits = 0;
    const off = subscribe(() => { hits++; });
    setPref("en");
    expect(getLang()).toBe("en");
    expect(t("settings.title")).toBe("Settings");
    expect(localStorage.getItem("im.language")).toBe("en");
    setPref("system");
    expect(getPref()).toBe("system");
    expect(localStorage.getItem("im.language")).toBeNull();
    off();
    expect(hits).toBe(2);
    setPref("zh-Hans");
    expect(t("settings.title")).toBe("设置");
  });
});
