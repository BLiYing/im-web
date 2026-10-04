// 省电模式 React 接线：订阅 store、起电量监听、根节点 no-anim / no-blur、§5 自动开启 Toast。
import { useEffect, useRef, useSyncExternalStore } from "react";
import { startBatteryMonitor } from "./powerBattery";
import { promptStep, type PowerItem } from "./powerSave";
import { getPowerSaveSnapshot, getPromptState, setPromptState, setPowerBattery, subscribePowerSave, type PowerSaveSnapshot } from "./powerSaveStore";
import { t } from "./i18n";

export function usePowerSave(): PowerSaveSnapshot {
  return useSyncExternalStore(subscribePowerSave, getPowerSaveSnapshot);
}

/** 某耗电项当前是否有效（用户值 && 未省电）；组件渲染分支用。 */
export function usePowerEffective(item: PowerItem): boolean {
  return useSyncExternalStore(subscribePowerSave, () => getPowerSaveSnapshot().effective[item]);
}

/** 应用启动时调一次（main.tsx）：电量监听 + 根节点 no-anim / no-blur class 跟随 store。登录页也生效。 */
export function installPowerSaving(): void {
  startBatteryMonitor(setPowerBattery);
  const apply = () => {
    const e = getPowerSaveSnapshot().effective;
    const root = document.documentElement;
    root.classList.toggle("no-anim", !e.animations);
    root.classList.toggle("no-blur", !e.blur);
  };
  apply();
  subscribePowerSave(apply);
}

/** §5 自动开启提示（登录后挂在设置面板宿主上）：每放电周期一次；后台触发则回前台 10 分钟内补弹。 */
export function usePowerSaveToast(setToast: (msg: string) => void): void {
  const toastRef = useRef(setToast);
  toastRef.current = setToast;
  useEffect(() => {
    const evaluate = () => {
      const s = getPowerSaveSnapshot();
      const r = promptStep(getPromptState(), {
        active: s.active, auto: s.prefs.mode === "auto", charging: s.battery.charging,
        hidden: document.hidden, now: Date.now(),
      });
      setPromptState(r.state);
      if (r.toast) toastRef.current(t("power_saving.auto_on_toast", { percent: s.prefs.threshold }));
    };
    evaluate();
    document.addEventListener("visibilitychange", evaluate);
    const off = subscribePowerSave(evaluate);
    return () => { document.removeEventListener("visibilitychange", evaluate); off(); };
  }, []);
}
