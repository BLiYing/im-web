// 通知设置模型 + localStorage 持久化 + React hook（NOTIFICATIONS_DESIGN §6/§3.7）。
//
// **每设备本地，退出登录不清**（同外观/语言）：一个 JSON blob 存 `im.notif.v1`，字段集合三端一致
// （`private.{enabled,preview,sound}` / `group.{同}` / `inApp.{sound,vibrate,preview}` /
// `badge.includeMuted` / `desktop.{enabled,sound,volume}`）。
//
// **per-field 回落**：localStorage 里的 JSON 若被手改/旧版本残留/损坏，逐字段各自校验，
// 非法值只回落该字段的默认值，不因为一个字段坏了就整份扔掉用户其余的偏好。
import { useCallback, useState } from "react";
import { LOG_TAG, logger } from "./logging/logger";

export type NotifySoundId = "none" | "default" | "chord" | "chime" | "rise" | "drop";

export const NOTIFY_SOUND_IDS: readonly NotifySoundId[] = ["none", "default", "chord", "chime", "rise", "drop"];

export interface NotifyTypeSettings {
  enabled: boolean;
  preview: boolean;
  sound: NotifySoundId;
}

export interface NotifySettings {
  private: NotifyTypeSettings;
  group: NotifyTypeSettings;
  inApp: { sound: boolean; vibrate: boolean; preview: boolean };
  badge: { includeMuted: boolean };
  desktop: { enabled: boolean; sound: boolean; volume: number };
}

/** §3.7 默认值：全开，音量 7，「包含免打扰会话」关（= 现行角标口径）。 */
export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = {
  private: { enabled: true, preview: true, sound: "default" },
  group: { enabled: true, preview: true, sound: "default" },
  inApp: { sound: false, vibrate: false, preview: false }, // 默认全关（2026-09-29 用户决定）
  badge: { includeMuted: false },
  desktop: { enabled: true, sound: true, volume: 7 },
};

const STORAGE_KEY = "im.notif.v1";

/** 未知 id（旧版本下线的音效 / 手改坏的值）一律回落 default，不是 none——静默变哑对用户更意外。 */
export function normalizeSoundId(v: unknown): NotifySoundId {
  return typeof v === "string" && (NOTIFY_SOUND_IDS as readonly string[]).includes(v) ? (v as NotifySoundId) : "default";
}

function normalizeBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** 音量钳制到 0～10 整数；非数字/越界回落传入的默认值。 */
function normalizeVolume(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(10, Math.max(0, Math.round(n)));
}

function normalizeType(v: unknown, fallback: NotifyTypeSettings): NotifyTypeSettings {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    enabled: normalizeBool(o.enabled, fallback.enabled),
    preview: normalizeBool(o.preview, fallback.preview),
    sound: "sound" in o ? normalizeSoundId(o.sound) : fallback.sound,
  };
}

/** 把任意输入（多半是 `JSON.parse` 的产物，可能是残缺/损坏/旧版本的）标准化成一份完整设置。
 *  纯函数，供 `loadNotifySettings` 与测试直接用。 */
export function parseNotifySettings(raw: unknown): NotifySettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_NOTIFY_SETTINGS;
  const inApp = (o.inApp && typeof o.inApp === "object" ? o.inApp : {}) as Record<string, unknown>;
  const badge = (o.badge && typeof o.badge === "object" ? o.badge : {}) as Record<string, unknown>;
  const desk = (o.desktop && typeof o.desktop === "object" ? o.desktop : {}) as Record<string, unknown>;
  return {
    private: normalizeType(o.private, d.private),
    group: normalizeType(o.group, d.group),
    inApp: {
      sound: normalizeBool(inApp.sound, d.inApp.sound),
      vibrate: normalizeBool(inApp.vibrate, d.inApp.vibrate),
      preview: normalizeBool(inApp.preview, d.inApp.preview),
    },
    badge: { includeMuted: normalizeBool(badge.includeMuted, d.badge.includeMuted) },
    desktop: {
      enabled: normalizeBool(desk.enabled, d.desktop.enabled),
      sound: normalizeBool(desk.sound, d.desktop.sound),
      volume: normalizeVolume(desk.volume, d.desktop.volume),
    },
  };
}

/** 读一次当前存储的设置（非法/缺失回落默认）。隐私模式/读取异常按默认值处理，不抛给调用方。 */
export function loadNotifySettings(): NotifySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_NOTIFY_SETTINGS };
    return parseNotifySettings(JSON.parse(raw));
  } catch (error) {
    logger.warn(LOG_TAG.app, "notify_settings_load_failed", { error: String(error) });
    return { ...DEFAULT_NOTIFY_SETTINGS };
  }
}

/** 写一次。隐私模式/配额满时静默失败（本设置不影响协议/账号，丢一次写不算灾难），记日志便于排查。 */
export function saveNotifySettings(s: NotifySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (error) {
    logger.warn(LOG_TAG.app, "notify_settings_save_failed", { error: String(error) });
  }
}

export interface UseNotifySettings {
  settings: NotifySettings;
  setPrivate: (patch: Partial<NotifyTypeSettings>) => void;
  setGroup: (patch: Partial<NotifyTypeSettings>) => void;
  setInApp: (patch: Partial<NotifySettings["inApp"]>) => void;
  setBadge: (patch: Partial<NotifySettings["badge"]>) => void;
  setDesktop: (patch: Partial<NotifySettings["desktop"]>) => void;
  /** 重置为默认值。**不碰任何会话的免打扰状态**——那是服务端数据，见 §3.6。 */
  reset: () => void;
}

/** 通知设置簇：自有状态（一份 JSON）+ 一组按字段的 setter + 持久化 + 重置（CODING_STYLE §7「①自有状态+一组操作」）。 */
export function useNotifySettings(): UseNotifySettings {
  const [settings, setSettings] = useState<NotifySettings>(loadNotifySettings);

  const commit = useCallback((next: NotifySettings) => {
    setSettings(next);
    saveNotifySettings(next);
  }, []);

  const setPrivate = useCallback((patch: Partial<NotifyTypeSettings>) => {
    setSettings((prev) => { const next = { ...prev, private: { ...prev.private, ...patch } }; saveNotifySettings(next); return next; });
  }, []);
  const setGroup = useCallback((patch: Partial<NotifyTypeSettings>) => {
    setSettings((prev) => { const next = { ...prev, group: { ...prev.group, ...patch } }; saveNotifySettings(next); return next; });
  }, []);
  const setInApp = useCallback((patch: Partial<NotifySettings["inApp"]>) => {
    setSettings((prev) => { const next = { ...prev, inApp: { ...prev.inApp, ...patch } }; saveNotifySettings(next); return next; });
  }, []);
  const setBadge = useCallback((patch: Partial<NotifySettings["badge"]>) => {
    setSettings((prev) => { const next = { ...prev, badge: { ...prev.badge, ...patch } }; saveNotifySettings(next); return next; });
  }, []);
  const setDesktop = useCallback((patch: Partial<NotifySettings["desktop"]>) => {
    setSettings((prev) => { const next = { ...prev, desktop: { ...prev.desktop, ...patch } }; saveNotifySettings(next); return next; });
  }, []);
  const reset = useCallback(() => commit({ ...DEFAULT_NOTIFY_SETTINGS }), [commit]);

  return { settings, setPrivate, setGroup, setInApp, setBadge, setDesktop, reset };
}
