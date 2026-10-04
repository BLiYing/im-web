import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPowerSaveSnapshot, getPromptState, isEffective, reloadPowerSaveStoreForTest, resetPowerSaveStoreForTest, setPromptState, setPowerBattery, setPowerPref, subscribePowerSave,
} from "./powerSaveStore";

beforeEach(() => { localStorage.clear(); resetPowerSaveStoreForTest(); });

describe("powerSaveStore", () => {
  it("默认：未生效，四项全有效", () => {
    const s = getPowerSaveSnapshot();
    expect(s.active).toBe(false);
    expect(s.effective).toEqual({ animations: true, blur: true, autoDownload: true, videoPreload: true });
  });
  it("auto + 低电量 → 生效，四项一律有效=false；用户值不被改写", () => {
    setPowerPref("mode", "auto");
    setPowerBattery({ supported: true, level: 10, charging: false });
    const s = getPowerSaveSnapshot();
    expect(s.active).toBe(true);
    expect(s.effective.autoDownload).toBe(false);
    expect(isEffective("videoPreload")).toBe(false);
    expect(s.prefs.autoDownload).toBe(true);
    setPowerBattery({ supported: true, level: 10, charging: true }); // 插电 → 退出，回到用户值
    expect(getPowerSaveSnapshot().effective.autoDownload).toBe(true);
  });
  it("用户关掉的项在不生效时也是 false；写入 localStorage", () => {
    setPowerPref("blur", false);
    expect(isEffective("blur")).toBe(false);
    expect(localStorage.getItem("im.blur")).toBe("0");
  });
  it("订阅：变更通知；值未变不通知", () => {
    const fn = vi.fn();
    const off = subscribePowerSave(fn);
    setPowerPref("mode", "always");
    expect(fn).toHaveBeenCalledTimes(1);
    setPowerPref("mode", "always");
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    setPowerPref("mode", "off");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("阈值写入被夹", () => {
    setPowerPref("threshold", 999);
    expect(getPowerSaveSnapshot().prefs.threshold).toBe(50);
  });
});

describe("§5 已提示记忆跨刷新（localStorage im.powerSaving.promptShown）", () => {
  const LOW = { supported: true, level: 10, charging: false };
  it("设置后写入存储；刷新后读回；电量仍低于阈值 → 保留", () => {
    setPromptState({ ...getPromptState(), prompted: true });
    expect(localStorage.getItem("im.powerSaving.promptShown")).toBe("1");
    reloadPowerSaveStoreForTest();
    expect(getPromptState().prompted).toBe(true);
    setPowerBattery(LOW);
    expect(getPromptState().prompted).toBe(true);
  });
  it("刷新后首个读数不低于阈值 → 清掉", () => {
    localStorage.setItem("im.powerSaving.promptShown", "1");
    reloadPowerSaveStoreForTest();
    setPowerBattery({ supported: true, level: 80, charging: false });
    expect(getPromptState().prompted).toBe(false);
    expect(localStorage.getItem("im.powerSaving.promptShown")).toBe("0");
  });
  it("刷新后首个读数在充电 → 清掉；观察到充电也清", () => {
    localStorage.setItem("im.powerSaving.promptShown", "1");
    reloadPowerSaveStoreForTest();
    setPowerBattery({ supported: true, level: 10, charging: true });
    expect(getPromptState().prompted).toBe(false);
    setPromptState({ ...getPromptState(), prompted: true });
    setPowerBattery({ supported: true, level: 9, charging: false });
    expect(getPromptState().prompted).toBe(true);
    setPowerBattery({ supported: true, level: 9, charging: true });
    expect(getPromptState().prompted).toBe(false);
  });
  it("存储读写抛错也不崩，按未提示处理", () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error("denied"); };
    try { reloadPowerSaveStoreForTest(); expect(getPromptState().prompted).toBe(false); }
    finally { Storage.prototype.getItem = orig; }
  });
});
