// 点首页搜索里的设置项 → 清搜索词、打开设置主页、逐级打开目标页（SEARCH_DESIGN §3.1）。
// 从 App.tsx 抽出只为守体量红线：一级页复用设置列表里那一行的 onClick（连同它自带的预加载），不另写一套。
import type { Row } from "./components/rows";
import { runSettingsRoute, type SettingsSearchEntry } from "./settingsSearch";

export function useOpenSettingsHit(p: {
  rows: Row[];
  clearSearch: () => void;
  showSettings: () => void;
  setWallpaperOpen: (v: boolean) => void;
  setBlockedOpen: (v: boolean) => void;
  setChangePwdOpen: (v: boolean) => void;
}) {
  return (e: SettingsSearchEntry) => {
    p.clearSearch();
    p.showSettings();
    runSettingsRoute(e.route, {
      openTop: (id) => p.rows.find((r) => r.id === id)?.onClick(),
      setWallpaperOpen: p.setWallpaperOpen,
      setBlockedOpen: p.setBlockedOpen,
      setChangePwdOpen: p.setChangePwdOpen,
    });
  };
}
