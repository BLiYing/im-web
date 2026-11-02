// 「关于我们」二级页的开合态：模块级小仓（同 emailLoginUi）。设置搜索命中「关于我们」要能直达该页，而 App.tsx 已卡体量红线。
import { useSyncExternalStore } from "react";

let open = false;
const subs = new Set<() => void>();
const set = (v: boolean) => { if (open !== v) { open = v; subs.forEach((f) => f()); } };

export const openAboutPanel = () => set(true);
export const closeAboutPanel = () => set(false);
export function useAboutPanelOpen(): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => open, () => false);
}
