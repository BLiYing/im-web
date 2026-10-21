// 「账号默认档位选择面板」的开合态：模块级小仓（useSyncExternalStore）。
// 为什么不进 App 的 state：设置搜索命中「自动删除消息」要能直达该二级页，而 App.tsx 已卡体量红线；
// 开关只有 SettingsPanelsHost 渲染面板、settingsSearch 路由两处读写，放模块级最省线。
import { useSyncExternalStore } from "react";

let open = false;
const subs = new Set<() => void>();
const set = (v: boolean) => { if (open !== v) { open = v; subs.forEach((f) => f()); } };

export const openAutoDeleteDefault = () => set(true);
export const closeAutoDeleteDefault = () => set(false);
export function useAutoDeleteDefaultOpen(): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => open, () => false);
}
