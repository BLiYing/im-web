// 省电模式运行态（模块级外部 store）：偏好（localStorage）+ 电量读数 → active + 各项 effective。
// 非 React 代码（useMediaSend 等）直接 isEffective()，组件经 usePowerSave() 订阅（见 usePowerSaving.ts）。
import {
  INITIAL_PROMPT_STATE, POWER_ITEMS, loadPromptShown, savePromptShown, clampThreshold, effectiveItem, loadPowerPrefs, powerSaveActive, savePowerPref,
  type BatteryReading, type PowerItem, type PowerPrefs, type PromptState,
} from "./powerSave";
import { initialBattery } from "./powerBattery";

export interface PowerSaveSnapshot {
  prefs: PowerPrefs;
  battery: BatteryReading;
  active: boolean;
  effective: Record<PowerItem, boolean>;
}

function derive(prefs: PowerPrefs, battery: BatteryReading): PowerSaveSnapshot {
  const active = powerSaveActive({
    mode: prefs.mode, threshold: prefs.threshold, level: battery.level, charging: battery.charging,
    followSystem: false, systemSaver: null, // Web 没有系统省电 API
  });
  const effective = {} as Record<PowerItem, boolean>;
  for (const k of POWER_ITEMS) effective[k] = effectiveItem(prefs[k], active);
  return { prefs, battery, active, effective };
}

let snap: PowerSaveSnapshot = derive(loadPowerPrefs(), initialBattery());
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getPowerSaveSnapshot = (): PowerSaveSnapshot => snap;
export function subscribePowerSave(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export const isEffective = (item: PowerItem): boolean => snap.effective[item];

export function setPowerPref<K extends keyof PowerPrefs>(key: K, value: PowerPrefs[K]): void {
  const v = (key === "threshold" ? clampThreshold(value as number) : value) as PowerPrefs[K];
  const prefs = { ...snap.prefs, [key]: v };
  savePowerPref(key, v);
  if (prefs[key] === snap.prefs[key]) return;
  snap = derive(prefs, snap.battery);
  emit();
}

export function setPowerBattery(battery: BatteryReading): void {
  const b = snap.battery;
  if (b.supported === battery.supported && b.level === battery.level && b.charging === battery.charging) return;
  snap = derive(snap.prefs, battery);
  reconcileAtStartup();
  if (battery.charging === true && promptState.prompted) setPromptState({ ...promptState, prompted: false }); // 观察到充电：周期结束
  emit();
}

export function resetPowerSaveStoreForTest(): void {
  snap = derive(loadPowerPrefs(), initialBattery({ override: null, getBattery: undefined }));
  promptState = INITIAL_PROMPT_STATE;
  startupChecked = true;
  emit();
}

/** §5 提示状态放模块级 + localStorage：设置宿主重挂载（退出→登录）、页面刷新都不丢「每放电周期一次」的记忆。 */
const freshPromptState = (): PromptState => ({ ...INITIAL_PROMPT_STATE, prompted: loadPromptShown() });
let promptState: PromptState = freshPromptState();
export const getPromptState = (): PromptState => promptState;
export function setPromptState(s: PromptState): void {
  if (s.prompted !== promptState.prompted) savePromptShown(s.prompted);
  promptState = s;
}

// 启动对账：第一次拿到电量读数（或确认读不到）时，若不在「低于阈值且未充电」，说明上一个放电周期已结束 → 清掉持久化的「已提示」。
let startupChecked = false;
function reconcileAtStartup(): void {
  if (startupChecked) return;
  const { battery: b, prefs } = snap;
  if (b.supported && b.level === null) return; // 读数还没到
  startupChecked = true;
  const lowNow = b.level !== null && b.charging === false && b.level <= prefs.threshold;
  if (!lowNow && promptState.prompted) setPromptState({ ...promptState, prompted: false });
}
reconcileAtStartup(); // 浏览器不支持读电量时立刻对账

/** 仅测试：重新读存储，模拟「刷新页面」；battery 默认「支持但读数待到」。 */
export function reloadPowerSaveStoreForTest(): void {
  snap = derive(loadPowerPrefs(), { supported: true, level: null, charging: null });
  promptState = freshPromptState();
  startupChecked = false;
  emit();
}
