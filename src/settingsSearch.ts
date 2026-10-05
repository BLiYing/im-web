// 设置项搜索（SEARCH_DESIGN §3.1 的 Web 落地）：显式登记表 + 匹配 + 打开路由，全部纯函数、不碰 React。
// 对称兄弟：iOS `IMSettingsSearchRegistry`、Android `SettingsSearchIndex`（SYMMETRY.md 登记）。
// Web 设置页与 iOS 条目不同（镜像 Telegram Web），所以登记的是 Web 实有的页面，不是照抄 iOS 的 24 条。
import { Bell, Database, Gauge, Image as ImageIcon, Languages, Lock, MonitorSmartphone, Ban, KeyRound, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type SettingsRoute =
  | "general" | "animations" | "notifications" | "data" | "privacy" | "devices" | "language"
  | "wallpaper" | "blocked" | "changePassword";

export interface SettingsSearchEntry {
  id: string;
  title: string;
  /** 所属页面路径，末项即自身标题；副标题由它拼出（一级页只有自身，显示「设置」）。 */
  path: string[];
  icon: LucideIcon;
  tint: string;
  aliases: string[];
  route: SettingsRoute;
}

export const PATH_SEPARATOR = " › ";

/** 「a,b，c」→ [a,b,c]：去空白、去空项（文案表 `search.alias.*` 的格式，三端同）。 */
export function splitAliases(raw: string): string[] {
  return raw.split(/[,，]/).map((s) => s.trim()).filter((s) => s.length > 0);
}

export function settingsSubtitle(e: SettingsSearchEntry, topLevelLabel: string): string {
  return e.path.length <= 1 ? topLevelLabel : e.path.join(PATH_SEPARATOR);
}

/** 登记表。`t` 是当前语言的取词函数，切语言后重新调用即得新标题 / 新别名。 */
export function settingsSearchEntries(t: (key: string) => string): SettingsSearchEntry[] {
  const general = t("general.title");
  const notif = t("settings.row.notifications");
  const privacy = t("settings.row.privacy");
  const mk = (id: string, route: SettingsRoute, path: string[], icon: LucideIcon, tint: string, aliases: string[] = []): SettingsSearchEntry =>
    ({ id, route, title: path[path.length - 1], path, icon, tint, aliases });
  return [
    mk("general", "general", [general], Settings2, "gray"),
    mk("animations", "animations", [t("settings.row.animations")], Gauge, "orange"),
    mk("notifications", "notifications", [notif], Bell, "red"),
    mk("notif_sound", "notifications", [notif, t("notif.type.sound")], Bell, "red", splitAliases(t("search.alias.sound"))),
    mk("data", "data", [t("settings.row.data_storage")], Database, "green", splitAliases(t("search.alias.auto_download"))),
    mk("privacy", "privacy", [privacy], Lock, "indigo"),
    mk("devices", "devices", [t("settings.row.devices")], MonitorSmartphone, "teal"),
    mk("language", "language", [t("settings.language.title")], Languages, "purple"),
    mk("wallpaper", "wallpaper", [general, t("general.wallpaper")], ImageIcon, "blue"),
    mk("blocked", "blocked", [privacy, t("blocked.title")], Ban, "red"),
    mk("changePassword", "changePassword", [privacy, t("settings.change_password")], KeyRound, "blue"),
  ];
}

/** 先标题 / 别名命中，再路径+标题拼接命中（搜「隐私」带出其下的二级页）；大小写不敏感，空串无命中。 */
export function filterSettingsEntries(entries: SettingsSearchEntry[], keyword: string): SettingsSearchEntry[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return [];
  const has = (s: string) => s.toLowerCase().includes(q);
  const direct = entries.filter((e) => [e.title, ...e.aliases].some(has));
  const seen = new Set(direct.map((e) => e.id));
  const viaPath = entries.filter((e) => !seen.has(e.id) && has(e.path.join(PATH_SEPARATOR)));
  return [...direct, ...viaPath];
}

export interface SettingsRouteHandlers {
  /** 打开设置主页下的一级页（等同点设置列表里那一行，含它自带的预加载）。 */
  openTop: (id: "general" | "animations" | "notifications" | "data" | "privacy" | "devices" | "language") => void;
  setWallpaperOpen: (v: boolean) => void;
  setBlockedOpen: (v: boolean) => void;
  setChangePwdOpen: (v: boolean) => void;
}

/** 逐级打开：先一级页、再二级页，返回键沿原路退（面板栈），不回搜索页。 */
export function runSettingsRoute(route: SettingsRoute, h: SettingsRouteHandlers): void {
  switch (route) {
    case "wallpaper": h.openTop("general"); h.setWallpaperOpen(true); return;
    case "blocked": h.openTop("privacy"); h.setBlockedOpen(true); return;
    case "changePassword": h.openTop("privacy"); h.setChangePwdOpen(true); return;
    default: h.openTop(route);
  }
}
