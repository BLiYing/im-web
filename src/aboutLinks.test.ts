import { describe, expect, it } from "vitest";
import { LEGAL_PATH, currentVersion, legalUrl, versionClipboardText, versionString } from "./aboutLinks";
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
