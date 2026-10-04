import { describe, it, expect, vi } from "vitest";
import { initialBattery, startBatteryMonitor, type BatteryManagerLike } from "./powerBattery";

function fakeManager(level: number, charging: boolean) {
  const ls = new Map<string, Set<() => void>>();
  const m = {
    level, charging,
    addEventListener: (t: string, f: () => void) => { (ls.get(t) ?? ls.set(t, new Set()).get(t)!).add(f); },
    removeEventListener: (t: string, f: () => void) => { ls.get(t)?.delete(f); },
    fire: (t: string) => ls.get(t)?.forEach((f) => f()),
    count: () => [...ls.values()].reduce((n, s) => n + s.size, 0),
  };
  return m satisfies BatteryManagerLike & Record<string, unknown>;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("initialBattery", () => {
  it("dev 覆盖优先、supported=true", () => {
    expect(initialBattery({ override: "10,false" })).toEqual({ supported: true, level: 10, charging: false });
  });
  it("无 getBattery → 不支持", () => {
    expect(initialBattery({ override: null, getBattery: undefined })).toEqual({ supported: false, level: null, charging: null });
  });
  it("有 getBattery → 支持但读数待定", () => {
    expect(initialBattery({ override: null, getBattery: async () => fakeManager(1, false) })).toEqual({ supported: true, level: null, charging: null });
  });
});

describe("startBatteryMonitor", () => {
  it("读数取整百分比，levelchange / chargingchange 更新，stop 后摘监听", async () => {
    const m = fakeManager(0.624, false);
    const onReading = vi.fn();
    const stop = startBatteryMonitor(onReading, { override: null, getBattery: async () => m });
    await flush();
    expect(onReading).toHaveBeenLastCalledWith({ supported: true, level: 62, charging: false });
    m.level = 0.15; m.fire("levelchange");
    expect(onReading).toHaveBeenLastCalledWith({ supported: true, level: 15, charging: false });
    m.charging = true; m.fire("chargingchange");
    expect(onReading).toHaveBeenLastCalledWith({ supported: true, level: 15, charging: true });
    stop();
    expect(m.count()).toBe(0);
  });
  it("dev 覆盖：不碰 getBattery", async () => {
    const getBattery = vi.fn();
    const onReading = vi.fn();
    startBatteryMonitor(onReading, { override: "10,false", getBattery });
    expect(onReading).toHaveBeenCalledWith({ supported: true, level: 10, charging: false });
    expect(getBattery).not.toHaveBeenCalled();
  });
  it("getBattery 缺失 / reject → 不支持，不抛", async () => {
    const a = vi.fn();
    startBatteryMonitor(a, { override: null, getBattery: undefined });
    expect(a).toHaveBeenCalledWith({ supported: false, level: null, charging: null });
    const b = vi.fn();
    startBatteryMonitor(b, { override: null, getBattery: () => Promise.reject(new Error("denied")) });
    await flush();
    expect(b).toHaveBeenLastCalledWith({ supported: false, level: null, charging: null });
  });
  it("stop 之后才 resolve 的 getBattery 不再回调", async () => {
    const m = fakeManager(0.5, false);
    const onReading = vi.fn();
    const stop = startBatteryMonitor(onReading, { override: null, getBattery: async () => m });
    stop();
    await flush();
    expect(onReading).not.toHaveBeenCalled();
    expect(m.count()).toBe(0);
  });
});
