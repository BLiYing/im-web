import { afterEach, describe, expect, it } from "vitest";
import { format, getLang, getPref, resolveLanguage, setPref, subscribe, t, tokenizeTemplate, translate } from "./index";

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

// P3：tokenizeTemplate 是 format() 与 sysEventRender.ts 系统消息占位符分流共用的分词器——
// 后者不能直接调 format(tpl, args)，需要逐 token 判断「这个占位符是不是人名槽位」。
describe("tokenizeTemplate", () => {
  it("按 {name} 切出 text/ph 交替序列", () => {
    expect(tokenizeTemplate("{actor} 将 {target} 移出群聊")).toEqual([
      { type: "ph", name: "actor" }, { type: "text", value: " 将 " },
      { type: "ph", name: "target" }, { type: "text", value: " 移出群聊" },
    ]);
  });
  it("{{ }} 转义为字面量花括号文本段", () => {
    expect(tokenizeTemplate("{{x}} {n}")).toEqual([
      { type: "text", value: "{" }, { type: "text", value: "x" }, { type: "text", value: "}" }, { type: "text", value: " " },
      { type: "ph", name: "n" },
    ]);
  });
  it("无占位符的纯文本 → 单个 text token", () => {
    expect(tokenizeTemplate("管理员开启了全员禁言")).toEqual([{ type: "text", value: "管理员开启了全员禁言" }]);
  });
  it("与 format() 用同一份分词结果拼回去等价（回归护栏：改分词不能悄悄改 format 输出）", () => {
    const tpl = "{actor} invited {names} to the group";
    const joined = tokenizeTemplate(tpl).map((tok) => (tok.type === "text" ? tok.value : `<${tok.name}>`)).join("");
    expect(joined).toBe("<actor> invited <names> to the group");
    expect(format(tpl, { actor: "Ann", names: "Bob, Carol" })).toBe("Ann invited Bob, Carol to the group");
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
