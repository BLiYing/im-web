// 省电模式纯逻辑（POWER_SAVING_DESIGN §3/§5/§6）。向量 testing/powerSave.vectors.json 源自
// IMServer docs/conformance/power_save.json，读法同 alertDecision.test.ts（拷贝 + 漂移守卫）。
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import vectors from "./testing/powerSave.vectors.json";
import {
  DEFAULT_POWER_PREFS, POWER_STORAGE_KEYS, PROMPT_BACKFILL_MS, clampThreshold, effectiveItem, loadPowerPrefs, pausedCount,
  parseBatteryOverride, powerSaveActive, promptStep, savePowerPref, type PowerSaveContext, type PromptState,
} from "./powerSave";

interface Case { name: string; ctx: PowerSaveContext; active: boolean }

describe("power_save 共用向量", () => {
  for (const c of (vectors as { cases: Case[] }).cases) {
    it(c.name, () => expect(powerSaveActive(c.ctx)).toBe(c.active));
  }
  it("本地副本与源向量一致（源在本机时才比）", () => {
    const abs = new URL("../../IMServer/docs/conformance/power_save.json", import.meta.url);
    if (!existsSync(abs)) return;
    expect(JSON.parse(readFileSync(abs, "utf8"))).toEqual(vectors);
  });
});

describe("clampThreshold", () => {
  it("越界夹到 5..50，非数字回默认 15", () => {
    expect(clampThreshold(0)).toBe(5);
    expect(clampThreshold(99)).toBe(50);
    expect(clampThreshold(20)).toBe(20);
    expect(clampThreshold(Number.NaN)).toBe(15);
  });
  it("判定里阈值越界也被夹（threshold=1 等同 5）", () => {
    const base: PowerSaveContext = { mode: "auto", threshold: 1, level: 5, charging: false, followSystem: false, systemSaver: null };
    expect(powerSaveActive(base)).toBe(true);
    expect(powerSaveActive({ ...base, level: 6 })).toBe(false);
  });
});

describe("effectiveItem", () => {
  it("生效时一律关，不生效时取用户值", () => {
    expect(effectiveItem(true, true)).toBe(false);
    expect(effectiveItem(false, true)).toBe(false);
    expect(effectiveItem(true, false)).toBe(true);
    expect(effectiveItem(false, false)).toBe(false);
  });
});

describe("parseBatteryOverride", () => {
  it("level,charging", () => {
    expect(parseBatteryOverride("10,false")).toEqual({ level: 10, charging: false });
    expect(parseBatteryOverride(" 80 , true ")).toEqual({ level: 80, charging: true });
  });
  it("非法输入 → null", () => {
    for (const bad of [null, "", "abc", "10", "10,maybe", "101,false", "-1,false", "1.5,true"]) {
      expect(parseBatteryOverride(bad)).toBeNull();
    }
  });
});

describe("本地存储", () => {
  const mem = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it("空存储 → 默认值（动画/毛玻璃/自动下载/视频预加载全开，off，15）", () => {
    expect(loadPowerPrefs(mem())).toEqual(DEFAULT_POWER_PREFS);
    expect(DEFAULT_POWER_PREFS).toMatchObject({ mode: "off", threshold: 15, animations: true, blur: true, autoDownload: true, videoPreload: true });
  });
  it("读已存值；非法值回默认；阈值被夹", () => {
    const s = mem({
      [POWER_STORAGE_KEYS.mode]: "auto", [POWER_STORAGE_KEYS.threshold]: "200",
      [POWER_STORAGE_KEYS.animations]: "0", [POWER_STORAGE_KEYS.blur]: "garbage",
    });
    expect(loadPowerPrefs(s)).toMatchObject({ mode: "auto", threshold: 50, animations: false, blur: true });
    expect(loadPowerPrefs(mem({ [POWER_STORAGE_KEYS.mode]: "weird" })).mode).toBe("off");
  });
  it("读写抛错也不崩：读回默认、写返回 false", () => {
    const boom = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(loadPowerPrefs(boom)).toEqual(DEFAULT_POWER_PREFS);
    expect(savePowerPref("mode", "always", boom)).toBe(false);
  });
  it("写后可读回（布尔存 1/0，键名按设计 §6）", () => {
    const s = mem();
    expect(savePowerPref("autoDownload", false, s)).toBe(true);
    expect(savePowerPref("threshold", 30, s)).toBe(true);
    expect(s.m.get("im.autoDownload")).toBe("0");
    expect(s.m.get("im.powerSaving.threshold")).toBe("30");
    expect(loadPowerPrefs(s)).toMatchObject({ autoDownload: false, threshold: 30 });
  });
});

describe("promptStep（§5：active 上升沿且原因是电量；每个放电周期一次；充电重置；后台触发回前台 10 分钟内补弹。镜像 Android PowerSavePromptTest）", () => {
  const init: PromptState = { prevActive: false, prompted: false, pendingAt: null };
  const on = { active: true, auto: true, charging: false as boolean | null, hidden: false, now: 1000 };
  const off = { ...on, active: false, auto: false };

  it("前台上升沿弹一次，状态再算一遍不重弹；充电重置后下个周期再弹", () => {
    const a = promptStep(init, on);
    expect(a.toast).toBe(true);
    const b = promptStep(a.state, { ...on, now: 2000 });
    expect(b.toast).toBe(false);
    const c = promptStep(b.state, { ...off, charging: true, now: 3000 });
    expect(c.state.prompted).toBe(false);
    const d = promptStep(c.state, { ...off, now: 4000 });
    expect(promptStep(d.state, { ...on, now: 5000 }).toast).toBe(true);
  });
  it("始终开启（原因不是电量）从不提示", () => {
    expect(promptStep(init, { ...on, auto: false }).toast).toBe(false);
    expect(promptStep(init, off).toast).toBe(false);
  });
  it("alwaysToAutoWhileAlreadyActiveIsNotRisingEdge：始终开启时已生效，再切到 auto 不是上升沿，不弹", () => {
    const a = promptStep(init, { ...on, auto: false });
    expect(promptStep(a.state, { ...on, now: 2000 }).toast).toBe(false);
  });
  it("未生效时选 auto 而电量已低 → 是上升沿，弹", () => {
    const a = promptStep(init, off);
    expect(promptStep(a.state, { ...on, now: 2000 }).toast).toBe(true);
  });
  it("充电状态未知(null)不重置周期", () => {
    const a = promptStep(init, on);
    const b = promptStep(a.state, { ...off, charging: null });
    expect(b.state.prompted).toBe(true);
  });
  it("后台触发：先不弹，回前台 10 分钟内补弹，仅一次", () => {
    const a = promptStep(init, { ...on, hidden: true });
    expect(a.toast).toBe(false);
    const b = promptStep(a.state, { ...on, now: 1000 + PROMPT_BACKFILL_MS });
    expect(b.toast).toBe(true);
    expect(promptStep(b.state, { ...on, now: 1000 + PROMPT_BACKFILL_MS + 1 }).toast).toBe(false);
  });
  it("后台超过 10 分钟再回前台，或回来时已不再生效：不补", () => {
    const a = promptStep(init, { ...on, hidden: true });
    const late = promptStep(a.state, { ...on, now: 1000 + PROMPT_BACKFILL_MS + 1 });
    expect(late.toast).toBe(false);
    expect(late.state.pendingAt).toBeNull();
    expect(promptStep(a.state, { ...off, now: 2000 }).toast).toBe(false);
  });
  it("后台期间仍在后台：不弹、保持待补；回前台前已充电 → 取消待补", () => {
    const a = promptStep(init, { ...on, hidden: true });
    const b = promptStep(a.state, { ...on, hidden: true, now: 5000 });
    expect(b.toast).toBe(false);
    expect(b.state.pendingAt).toBe(1000);
    const c = promptStep(a.state, { ...off, charging: true, hidden: true, now: 2000 });
    expect(promptStep(c.state, { ...on, now: 3000, charging: false }).toast).toBe(true); // 新周期：新的上升沿
    expect(c.state.pendingAt).toBeNull();
  });
});

describe("pausedCount（状态行「{n} 项已暂停」= 用户值为开、被省电实际暂停的项）", () => {
  it("全开 → 4；用户自己关掉的不算", () => {
    expect(pausedCount(DEFAULT_POWER_PREFS)).toBe(4);
    expect(pausedCount({ ...DEFAULT_POWER_PREFS, animations: false, videoPreload: false })).toBe(2);
    expect(pausedCount({ ...DEFAULT_POWER_PREFS, animations: false, blur: false, autoDownload: false, videoPreload: false })).toBe(0);
  });
});
