// 省电模式纯逻辑（POWER_SAVING_DESIGN §3 判据 / §5 自动开启提示 / §6 存储）。无 React、无 DOM 依赖。
// 判据的真相是 IMServer docs/conformance/power_save.json 向量（powerSave.test.ts 读拷贝 + 漂移守卫）；
// 对端：iOS IMPowerSaveActive、Android PowerSaveActive（SYMMETRY.md 登记）。改规则先改向量。

export type PowerMode = "off" | "auto" | "always";

export const THRESHOLD_MIN = 5;
export const THRESHOLD_MAX = 50;
export const THRESHOLD_STEP = 5;
export const THRESHOLD_DEFAULT = 15;

export interface PowerSaveContext {
  mode: PowerMode;
  threshold: number;
  /** 0..100；null = 读不到电量。 */
  level: number | null;
  /** null = 未知（不触发 auto，宁可不省电也不在插着电时误开）。 */
  charging: boolean | null;
  /** Web 恒 false。 */
  followSystem: boolean;
  /** Web 恒 null。 */
  systemSaver: boolean | null;
}

/** 阈值夹到 5..50；非有限数回默认 15。 */
export function clampThreshold(v: number): number {
  if (!Number.isFinite(v)) return THRESHOLD_DEFAULT;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, v));
}

export function powerSaveActive(ctx: PowerSaveContext): boolean {
  if (ctx.mode === "always") return true;
  if (ctx.mode === "auto" && ctx.level !== null && ctx.charging === false && ctx.level <= clampThreshold(ctx.threshold)) return true;
  return ctx.followSystem && ctx.systemSaver === true;
}

// ── 耗电项 + 本地存储（§6）────────────────────────────────────────────────

export type PowerItem = "animations" | "blur" | "autoDownload" | "videoPreload";
export const POWER_ITEMS: readonly PowerItem[] = ["animations", "blur", "autoDownload", "videoPreload"];

export interface PowerPrefs {
  mode: PowerMode;
  threshold: number;
  animations: boolean;
  blur: boolean;
  autoDownload: boolean;
  videoPreload: boolean;
}

export const DEFAULT_POWER_PREFS: PowerPrefs = {
  mode: "off", threshold: THRESHOLD_DEFAULT, animations: true, blur: true, autoDownload: true, videoPreload: true,
};

export const POWER_STORAGE_KEYS: Record<keyof PowerPrefs, string> = {
  mode: "im.powerSaving.mode",
  threshold: "im.powerSaving.threshold",
  animations: "im.animations",
  blur: "im.blur",
  autoDownload: "im.autoDownload",
  videoPreload: "im.videoPreload",
};

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem">;

function readRaw(key: string, storage: ReadStorage | undefined): string | null {
  try { return (storage ?? localStorage).getItem(key); } catch { return null; }
}

function readBool(key: string, storage: ReadStorage | undefined, dflt: boolean): boolean {
  const v = readRaw(key, storage);
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return dflt;
}

/** 每一项各自校验、各自回默认；读不到（隐私模式/被禁用）也只是默认值。 */
export function loadPowerPrefs(storage?: ReadStorage): PowerPrefs {
  const d = DEFAULT_POWER_PREFS;
  const mode = readRaw(POWER_STORAGE_KEYS.mode, storage);
  const thr = readRaw(POWER_STORAGE_KEYS.threshold, storage);
  return {
    mode: mode === "off" || mode === "auto" || mode === "always" ? mode : d.mode,
    threshold: thr === null || thr.trim() === "" ? d.threshold : clampThreshold(Number(thr)),
    animations: readBool(POWER_STORAGE_KEYS.animations, storage, d.animations),
    blur: readBool(POWER_STORAGE_KEYS.blur, storage, d.blur),
    autoDownload: readBool(POWER_STORAGE_KEYS.autoDownload, storage, d.autoDownload),
    videoPreload: readBool(POWER_STORAGE_KEYS.videoPreload, storage, d.videoPreload),
  };
}

/** 写一项；失败返回 false（调用方照常更新内存态，本次会话仍生效）。 */
export function savePowerPref<K extends keyof PowerPrefs>(key: K, value: PowerPrefs[K], storage?: WriteStorage): boolean {
  const raw = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  try { (storage ?? localStorage).setItem(POWER_STORAGE_KEYS[key], raw); return true; } catch { return false; }
}

/** 状态行「{n} 项已暂停」：用户值为开、因省电而实际被暂停的项数。 */
export function pausedCount(prefs: PowerPrefs): number {
  return POWER_ITEMS.filter((k) => prefs[k]).length;
}

/** effective(item) = userValue && !active（§3）：退出省电时自然回到用户值，没有「恢复」这一步。 */
export function effectiveItem(userValue: boolean, active: boolean): boolean {
  return userValue && !active;
}

// ── 电量读数 ───────────────────────────────────────────────────────────────

export interface BatteryReading {
  /** 浏览器是否能读电量（Safari / Firefox 没有 getBattery → false，auto 选项置灰）。 */
  supported: boolean;
  level: number | null;
  charging: boolean | null;
}

export const BATTERY_DEBUG_KEY = "im.debug.battery";

/** dev 覆盖串 "10,false"（level,charging）→ 读数；格式不对 null。仅 dev 构建才会被调用方采纳。 */
export function parseBatteryOverride(raw: string | null | undefined): { level: number; charging: boolean } | null {
  if (!raw) return null;
  const m = /^\s*(\d{1,3})\s*,\s*(true|false)\s*$/.exec(raw);
  if (!m) return null;
  const level = Number(m[1]);
  if (level > 100) return null;
  return { level, charging: m[2] === "true" };
}

// ── §5 自动开启提示：每个放电周期一次 ───────────────────────────────────────

export interface PromptState {
  /** 上一次评估时是否生效（用来判上升沿：始终开启 → 自动 不算新触发）。 */
  prevActive: boolean;
  /** 本放电周期已提示（或已登记待补）；开始充电重置。 */
  prompted: boolean;
  /** 在后台触发时的时间戳，回前台 10 分钟内补弹。 */
  pendingAt: number | null;
}

export const PROMPT_SHOWN_KEY = "im.powerSaving.promptShown";

/** 「本放电周期已提示」跨页面刷新保留（对齐 Android）；读写失败按「未提示」处理。 */
export function loadPromptShown(storage?: ReadStorage): boolean {
  return readRaw(PROMPT_SHOWN_KEY, storage) === "1";
}
export function savePromptShown(shown: boolean, storage?: WriteStorage): boolean {
  try { (storage ?? localStorage).setItem(PROMPT_SHOWN_KEY, shown ? "1" : "0"); return true; } catch { return false; }
}

export const INITIAL_PROMPT_STATE: PromptState = { prevActive: false, prompted: false, pendingAt: null };
export const PROMPT_BACKFILL_MS = 10 * 60 * 1000;

export interface PromptInput {
  active: boolean;
  /** 生效原因是电量（mode==="auto"）；手动「始终开启」不提示。 */
  auto: boolean;
  charging: boolean | null;
  hidden: boolean;
  now: number;
}

/** 语义与 Android PowerSavePrompt 一致：只在 active false→true 且原因是电量时提示，每放电周期一次。 */
export function promptStep(state: PromptState, i: PromptInput): { state: PromptState; toast: boolean } {
  let next: PromptState = { ...state, prevActive: i.active };
  if (i.charging === true) next = { ...next, prompted: false, pendingAt: null };
  if (!i.active) next = { ...next, pendingAt: null };
  const rising = i.active && !state.prevActive && i.auto;
  if (rising && !next.prompted) {
    return i.hidden
      ? { state: { ...next, prompted: true, pendingAt: i.now }, toast: false }
      : { state: { ...next, prompted: true, pendingAt: null }, toast: true };
  }
  if (next.pendingAt !== null && !i.hidden) {
    return { state: { ...next, pendingAt: null }, toast: i.now - next.pendingAt <= PROMPT_BACKFILL_MS };
  }
  return { state: next, toast: false };
}
