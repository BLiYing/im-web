import { describe, expect, it } from "vitest";
import { LEGAL_PATH, currentVersion, legalUrl, resolveAboutLink, versionClipboardText, versionString } from "./aboutLinks";
import { filterSettingsEntries, runSettingsRoute, settingsSearchEntries } from "./settingsSearch";
import { translate } from "./i18n";

describe("aboutLinks", () => {
  it("legalUrl：白名单路径 + lang；其它路径返回 null", () => {
    expect(legalUrl(LEGAL_PATH.privacy, "zh-Hans")).toBe("/legal/privacy?lang=zh-Hans");
    expect(legalUrl(LEGAL_PATH.terms, "en")).toBe("/legal/terms?lang=en");
    expect(legalUrl(LEGAL_PATH.support, "en")).toBe("/support?lang=en");
    expect(legalUrl("/api/v1/login", "en")).toBeNull();
    expect(legalUrl("https://evil.example/x", "en")).toBeNull();
  });

  it("versionString：版本 + 构建号，缺一退化，都缺为「-」", () => {
    expect(versionString("0.1.0", "a1b2c3d")).toBe("0.1.0 (a1b2c3d)");
    expect(versionString("0.1.0", "")).toBe("0.1.0");
    expect(versionString(undefined, "a1b2c3d")).toBe("a1b2c3d");
    expect(versionString()).toBe("-");
  });

  it("复制串带平台名；未注入 define 时 currentVersion 不抛", () => {
    expect(versionClipboardText("0.1.0 (a1b2c3d)")).toBe("Web 0.1.0 (a1b2c3d)");
    expect(typeof currentVersion()).toBe("string");
  });
});

describe("resolveAboutLink（后台可配置链接 → 最终 URL）", () => {
  const data = {
    privacy_url: "/legal/privacy", terms_url: "https://corp.example.com/terms?x=1",
    support_url: "/support", customer_service_url: "http://192.168.1.12:8091/?ck=ck_abc",
  };

  it("服务端相对路径：走 legalUrl（同源路径 + ?lang=）", () => {
    expect(resolveAboutLink("privacy", data, "zh-Hans")).toBe("/legal/privacy?lang=zh-Hans");
    expect(resolveAboutLink("support", data, "en")).toBe("/support?lang=en");
  });

  it("绝对 http(s) URL：原样返回，不追加 ?lang=", () => {
    expect(resolveAboutLink("terms", data, "en")).toBe("https://corp.example.com/terms?x=1");
    expect(resolveAboutLink("customerService", data, "zh-Hans")).toBe("http://192.168.1.12:8091/?ck=ck_abc");
  });

  it("空串/缺字段：法务三项退回内置路径，在线客服为 null（隐藏）", () => {
    expect(resolveAboutLink("privacy", { privacy_url: "" }, "en")).toBe("/legal/privacy?lang=en");
    expect(resolveAboutLink("terms", {}, "zh-Hans")).toBe("/legal/terms?lang=zh-Hans");
    expect(resolveAboutLink("customerService", { customer_service_url: "" }, "en")).toBeNull();
    expect(resolveAboutLink("customerService", {}, "en")).toBeNull();
  });

  it("拉取失败（data=null）：法务三项内置路径，在线客服 null", () => {
    expect(resolveAboutLink("privacy", null, "en")).toBe("/legal/privacy?lang=en");
    expect(resolveAboutLink("support", null, "zh-Hans")).toBe("/support?lang=zh-Hans");
    expect(resolveAboutLink("customerService", null, "en")).toBeNull();
  });

  it("危险/不合法值一律 null：javascript:、data:、ftp:、非白名单相对路径、乱码", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>1</script>", "ftp://x.example.com/", "/api/v1/login", "not a url", "//evil.example.com/x"]) {
      expect(resolveAboutLink("customerService", { customer_service_url: bad }, "en"), bad).toBeNull();
      expect(resolveAboutLink("terms", { terms_url: bad }, "en"), bad).toBeNull();
    }
  });
});

describe("设置搜索：关于我们", () => {
  const entries = settingsSearchEntries((k) => translate("zh-Hans", k));
  it("别名命中同一个入口（二级页里的行不单独登记）", () => {
    for (const kw of ["关于", "隐私政策", "服务条款", "技术支持", "版本"]) {
      expect(filterSettingsEntries(entries, kw).some((e) => e.id === "about"), kw).toBe(true);
    }
  });
  it("路由直达：调 openAbout，不走 openTop", () => {
    const calls: string[] = [];
    runSettingsRoute("about", {
      openTop: () => calls.push("top"), setWallpaperOpen: () => {}, setBlockedOpen: () => {}, setChangePwdOpen: () => {},
      openAbout: () => calls.push("about"),
    });
    expect(calls).toEqual(["about"]);
  });
});
