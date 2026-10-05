import { describe, expect, it, vi } from "vitest";
import { filterSettingsEntries, runSettingsRoute, settingsSearchEntries, settingsSubtitle, splitAliases } from "./settingsSearch";
import zh from "./i18n/locales/zh-Hans.json";

const t = (k: string) => String((zh as unknown as Record<string, unknown>)[k] ?? k);
const all = settingsSearchEntries(t);
const ids = (kw: string) => filterSettingsEntries(all, kw).map((e) => e.id);

describe("settingsSearch", () => {
  it("登记表标题都取到了真实文案（不是回落成键名）", () => {
    for (const e of all) for (const p of e.path) expect(p, e.id).not.toMatch(/^[a-z_]+\.[a-z_.]+$/);
  });
  it("标题命中；空串无命中", () => {
    expect(ids("语言")).toContain("language");
    expect(ids("  ")).toEqual([]);
  });
  it("同义词：声音→通知提示音行；自动下载→数据与存储", () => {
    expect(ids("声音")[0]).toBe("notif_sound");
    expect(ids("自动下载")).toContain("data");
  });
  it("搜一级页名带出其下二级页，且排在直接命中之后", () => {
    const r = ids("隐私");
    expect(r[0]).toBe("privacy");
    expect(r).toEqual(expect.arrayContaining(["blocked", "changePassword"]));
  });
  it("副标题：一级页显示顶层名，二级页显示「A › B」", () => {
    const byId = (id: string) => all.find((e) => e.id === id)!;
    expect(settingsSubtitle(byId("language"), "设置")).toBe("设置");
    expect(settingsSubtitle(byId("blocked"), "设置")).toBe(`${t("settings.row.privacy")} › ${t("blocked.title")}`);
  });
  it("splitAliases 半角全角逗号都认", () => {
    expect(splitAliases(" 声音,提示音，铃声 ,, ")).toEqual(["声音", "提示音", "铃声"]);
  });
  it("路由逐级打开：二级页先开它的一级页", () => {
    const h = { openTop: vi.fn(), setWallpaperOpen: vi.fn(), setBlockedOpen: vi.fn(), setChangePwdOpen: vi.fn() };
    runSettingsRoute("blocked", h);
    expect(h.openTop).toHaveBeenCalledWith("privacy");
    expect(h.setBlockedOpen).toHaveBeenCalledWith(true);
    runSettingsRoute("language", h);
    expect(h.openTop).toHaveBeenLastCalledWith("language");
  });
});
