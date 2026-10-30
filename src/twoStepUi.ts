// 「两步验证」二级页的开合态：模块级小仓（同 autoDeleteUi）。
// 设置搜索命中「两步验证」要能直达该页，而 App.tsx 已卡体量红线；开关只有 SettingsPanelsHost 与 settingsSearch 路由读写。
import { useSyncExternalStore } from "react";

let open = false;
const subs = new Set<() => void>();
const set = (v: boolean) => { if (open !== v) { open = v; subs.forEach((f) => f()); } };

export const openTwoStepPanel = () => set(true);
export const closeTwoStepPanel = () => set(false);
export function useTwoStepPanelOpen(): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => open, () => false);
}
