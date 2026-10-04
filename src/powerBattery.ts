// 电池读数（navigator.getBattery）：Chrome / Edge / 桌面版有；Safari / Firefox 没有 → supported=false。
// dev 构建可用 localStorage["im.debug.battery"]="10,false"（level,charging）覆盖读数；生产构建忽略。
import { BATTERY_DEBUG_KEY, parseBatteryOverride, type BatteryReading } from "./powerSave";
import { LOG_TAG, logger } from "./logging/logger";

export interface BatteryManagerLike {
  level: number;
  charging: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface BatteryEnv {
  /** dev 覆盖原始串（生产构建传 null）。 */
  override: string | null;
  getBattery?: () => Promise<BatteryManagerLike>;
}

const UNSUPPORTED: BatteryReading = { supported: false, level: null, charging: null };

/** 当前运行环境：dev 才读覆盖键；getBattery 取自 navigator。 */
export function defaultBatteryEnv(): BatteryEnv {
  let override: string | null = null;
  if (import.meta.env.DEV) {
    try { override = localStorage.getItem(BATTERY_DEBUG_KEY); } catch { override = null; }
  }
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> });
  return { override, getBattery: nav?.getBattery ? () => nav.getBattery!() : undefined };
}

/** 同步初值：能否读电量立刻可知（避免「自动」选项闪一下置灰），具体读数待异步到位。 */
export function initialBattery(env: BatteryEnv = defaultBatteryEnv()): BatteryReading {
  const o = parseBatteryOverride(env.override);
  if (o) return { supported: true, ...o };
  return env.getBattery ? { supported: true, level: null, charging: null } : UNSUPPORTED;
}

/** 起监听；返回 stop。读数经 onReading 推出（level 取整百分比）。 */
export function startBatteryMonitor(onReading: (r: BatteryReading) => void, env: BatteryEnv = defaultBatteryEnv()): () => void {
  const o = parseBatteryOverride(env.override);
  if (o) { onReading({ supported: true, ...o }); return () => {}; }
  if (!env.getBattery) { onReading(UNSUPPORTED); return () => {}; }
  let stopped = false;
  let mgr: BatteryManagerLike | null = null;
  const read = () => {
    if (mgr) onReading({ supported: true, level: Math.round(mgr.level * 100), charging: mgr.charging });
  };
  env.getBattery().then((m) => {
    if (stopped) return;
    mgr = m;
    m.addEventListener("levelchange", read);
    m.addEventListener("chargingchange", read);
    read();
  }).catch((e: unknown) => {
    logger.warn(LOG_TAG.app, "battery_unavailable", { error: e });
    if (!stopped) onReading(UNSUPPORTED);
  });
  return () => {
    stopped = true;
    if (mgr) { mgr.removeEventListener("levelchange", read); mgr.removeEventListener("chargingchange", read); }
  };
}
