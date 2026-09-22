// 主进程界面语言：偏好落盘 / 恢复、跟随系统、非法入参、切换回调。托盘菜单本身要真 Electron，靠 e2e，不在这里。
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLanguageState } from "../src/main/language";
import { parsePref, resolveLanguage, format } from "../src/shared/i18nCore";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "im-lang-")), "sub", "lang.json");

describe("i18nCore（与 im-web/src/i18n 同口径）", () => {
  it("resolveLanguage：首个被支持的；繁体归简体；都不支持回落 en", () => {
    expect(resolveLanguage("system", ["fr-FR", "en-US"])).toBe("en");
    expect(resolveLanguage("system", ["zh-Hant-TW"])).toBe("zh-Hans");
    expect(resolveLanguage("system", ["fr"])).toBe("en");
    expect(resolveLanguage("en", ["zh-CN"])).toBe("en");
  });
  it("parsePref 只认三个值", () => {
    expect(parsePref("en")).toBe("en");
    expect(parsePref("system")).toBe("system");
    expect(parsePref("fr")).toBeNull();
    expect(parsePref(undefined)).toBeNull();
    expect(parsePref({ pref: "en" })).toBeNull();
  });
  it("format：具名占位符 / {{ }} / 缺参保留", () => {
    expect(format("a {x} {{b}}", { x: 1 })).toBe("a 1 {b}");
    expect(format("a {x}")).toBe("a {x}");
  });
});

describe("createLanguageState", () => {
  it("没有文件 → 跟随系统；托盘文案随语言", () => {
    const s = createLanguageState({ file: tmpFile(), systemLangs: () => ["en-US"] });
    expect(s.pref()).toBe("system");
    expect(s.t("desktop.tray.quit")).toBe("Quit IM Desktop");
    const zh = createLanguageState({ file: tmpFile(), systemLangs: () => ["zh-CN"] });
    expect(zh.t("desktop.tray.quit")).toBe("退出 IM Desktop");
  });

  it("set：落盘、重启后恢复、变了才回调", () => {
    const file = tmpFile();
    const onChange = vi.fn();
    const s = createLanguageState({ file, systemLangs: () => ["zh-CN"], onChange });
    expect(s.set("en")).toBe(true);
    expect(onChange).toHaveBeenCalledWith("en");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ pref: "en" });
    expect(s.set("en")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);          // 没变不重复回调
    const again = createLanguageState({ file, systemLangs: () => ["zh-CN"] });
    expect(again.pref()).toBe("en");                    // 重启后仍是 en，不被系统语言盖掉
    expect(again.t("desktop.tray.show_window")).toBe("Show main window");
  });

  it("非法入参（IPC 不可信）→ 拒绝且状态不变、不落盘", () => {
    const file = tmpFile();
    const s = createLanguageState({ file, systemLangs: () => ["zh-CN"] });
    expect(s.set("klingon")).toBe(false);
    expect(s.set(42)).toBe(false);
    expect(s.pref()).toBe("system");
    expect(() => readFileSync(file)).toThrow();
  });

  it("文件损坏 / 内容非法 → 回落跟随系统，不抛", () => {
    const file = tmpFile();
    const s0 = createLanguageState({ file, systemLangs: () => ["en"] });
    s0.set("zh-Hans");
    writeFileSync(file, "{not json");
    expect(createLanguageState({ file, systemLangs: () => ["en"] }).pref()).toBe("system");
    writeFileSync(file, JSON.stringify({ pref: "fr" }));
    expect(createLanguageState({ file, systemLangs: () => ["en"] }).pref()).toBe("system");
  });
});
