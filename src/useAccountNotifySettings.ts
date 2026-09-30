// 账号级通知设置同步壳（M5）：在每设备本地的 useNotifySettings 基础上，把 private/group/badge
// 接到服务端（GET/PUT /api/v1/notify-settings，PROTOCOL §6.13 + PUSH_M5_DESIGN §3.3）。
// inApp.*/desktop.* 不动，仍纯本地（这两组从来不在 wire 契约里）。
//
// 决策/wire 映射全部是纯函数，见 notifySettingsSync.ts（含测试）；本文件只做「调用时机 + 网络 + 持久化脏标记」
// 这层胶水，逻辑与 iOS `IMNotificationSettings`、Android 同名类一致——改一处三端都要看。
//
// 用法（见 App.tsx）：`useAccountNotifySettings({ clientRef })` 替换原来的 `useNotifySettings()`；
// 返回值形状是 UseNotifySettings 的超集（多了 syncAfterLogin/onServerVersionBump），
// NotificationsPanel/SettingsPanelsHost 不用改。
import { useCallback, useRef } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import {
  DEFAULT_NOTIFY_SETTINGS, useNotifySettings,
  type NotifySettings, type NotifyTypeSettings, type UseNotifySettings,
} from "./notifySettings";
import {
  accountFieldsFromWire, accountFieldsToWire, decideLoginSync, shouldRefetchOnFrame,
  type AccountNotifyFields,
} from "./notifySettingsSync";
import { LOG_TAG, logger } from "./logging/logger";

const SYNC_STORAGE_KEY = "im.notif.sync.v1";

interface SyncState {
  /** 这份同步状态（以及本地的 private/group/badge 值）属于哪个账号；空 = 升级前的老数据，归第一个登录的账号。 */
  uid: string;
  version: number;
  /** 上一次本地编辑的 PUT 还没成功送达服务端（网络失败/掉线）：下次登录/重连要先补推，不能被 GET 覆盖。 */
  dirty: boolean;
}

function loadSyncState(): SyncState {
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY);
    if (!raw) return { uid: "", version: 0, dirty: false };
    const o = JSON.parse(raw) as Partial<SyncState>;
    return {
      uid: typeof o.uid === "string" ? o.uid : "",
      version: typeof o.version === "number" && Number.isFinite(o.version) ? o.version : 0,
      dirty: o.dirty === true,
    };
  } catch {
    return { uid: "", version: 0, dirty: false };
  }
}

function saveSyncState(s: SyncState): void {
  try {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(s));
  } catch (error) {
    logger.warn(LOG_TAG.app, "notify_settings_sync_state_save_failed", { error: String(error) });
  }
}

function accountFieldsOf(s: NotifySettings): AccountNotifyFields {
  return { private: s.private, group: s.group, badge: s.badge };
}

export interface UseAccountNotifySettings extends UseNotifySettings {
  /** 登录/重连后调用一次（传本次登录的 uid；不传=沿用上次的账号）：dirty→重试推送本地编辑；
   *  否则 exists=false→迁移推送，exists=true→服务端覆盖本地。 */
  syncAfterLogin: (uid?: string) => Promise<void>;
  /** 收到 `notify_settings_update` 帧时调用：版本号比本地新才重新走一遍 syncAfterLogin 的判定。 */
  onServerVersionBump: (version: number) => void;
}

export function useAccountNotifySettings(deps: { clientRef: MutableRefObject<IMClient | null> }): UseAccountNotifySettings {
  const { clientRef } = deps;
  const notif = useNotifySettings();
  const notifRef = useRef(notif);
  notifRef.current = notif;
  const syncRef = useRef<SyncState>(loadSyncState());

  /** 把某份账号级字段整体 PUT 上去；成功记新版本清 dirty，失败保留本地值、标 dirty 供下次重试。 */
  const pushAccountFields = useCallback(async (fields: AccountNotifyFields): Promise<boolean> => {
    const c = clientRef.current;
    if (!c) return false;
    try {
      const res = await c.saveNotifySettings(accountFieldsToWire(fields));
      syncRef.current = { ...syncRef.current, version: Number(res?.version) || 0, dirty: false };
      saveSyncState(syncRef.current);
      return true;
    } catch (error) {
      syncRef.current = { ...syncRef.current, dirty: true };
      saveSyncState(syncRef.current);
      logger.warn(LOG_TAG.app, "notify_settings_push_failed", { error: String(error) });
      return false;
    }
  }, [clientRef]);

  const syncAfterLogin = useCallback(async (uid?: string) => {
    const c = clientRef.current;
    if (!c) return;
    // 换了账号：本地的 private/group/badge 与「待补推」标记都是上一个账号的，既不能补推到新账号，
    // 也不能在新账号 exists=false 时当成它的值迁移上去——先恢复默认、清掉同步状态（同 Android forget()）。
    if (uid && syncRef.current.uid && syncRef.current.uid !== uid) {
      const d = accountFieldsOf(DEFAULT_NOTIFY_SETTINGS);
      notifRef.current.setPrivate(d.private);
      notifRef.current.setGroup(d.group);
      notifRef.current.setBadge(d.badge);
      notifRef.current = { ...notifRef.current, settings: { ...notifRef.current.settings, ...d } };
      syncRef.current = { uid, version: 0, dirty: false };
      saveSyncState(syncRef.current);
    } else if (uid && !syncRef.current.uid) {
      syncRef.current = { ...syncRef.current, uid };
      saveSyncState(syncRef.current);
    }
    if (syncRef.current.dirty) {
      // 补推：失败仍保持 dirty、不覆盖本地——用户还没确认送达的编辑，绝不能被随后的默认值/旧服务端值盖掉。
      await pushAccountFields(accountFieldsOf(notifRef.current.settings));
      return;
    }
    try {
      const res = await c.notifySettings();
      const action = decideLoginSync(false, !!res?.exists);
      if (action === "migrate_push") {
        await pushAccountFields(accountFieldsOf(notifRef.current.settings));
        return;
      }
      // overwrite_local：服务端已有这份设置，以它为准覆盖本地。
      const merged = accountFieldsFromWire(res?.settings, accountFieldsOf(notifRef.current.settings));
      notifRef.current.setPrivate(merged.private);
      notifRef.current.setGroup(merged.group);
      notifRef.current.setBadge(merged.badge);
      syncRef.current = { ...syncRef.current, version: Number(res?.version) || 0, dirty: false };
      saveSyncState(syncRef.current);
    } catch (error) {
      logger.warn(LOG_TAG.app, "notify_settings_fetch_failed", { error: String(error) });
    }
  }, [clientRef, pushAccountFields]);

  const onServerVersionBump = useCallback((version: number) => {
    if (!shouldRefetchOnFrame(version, syncRef.current.version)) return;
    void syncAfterLogin();
  }, [syncAfterLogin]);

  /** 本地编辑三件套的共同尾巴：先本地落地（继承自 useNotifySettings，立即生效），再异步 PUT 账号级字段。 */
  const setPrivate = useCallback((patch: Partial<NotifyTypeSettings>) => {
    notif.setPrivate(patch);
    void pushAccountFields({ ...accountFieldsOf(notif.settings), private: { ...notif.settings.private, ...patch } });
  }, [notif, pushAccountFields]);

  const setGroup = useCallback((patch: Partial<NotifyTypeSettings>) => {
    notif.setGroup(patch);
    void pushAccountFields({ ...accountFieldsOf(notif.settings), group: { ...notif.settings.group, ...patch } });
  }, [notif, pushAccountFields]);

  const setBadge = useCallback((patch: Partial<NotifySettings["badge"]>) => {
    notif.setBadge(patch);
    void pushAccountFields({ ...accountFieldsOf(notif.settings), badge: { ...notif.settings.badge, ...patch } });
  }, [notif, pushAccountFields]);

  /** 重置也算「本地编辑」——账号级三项跟着推默认值，否则重置只改了本地，下次登录又被服务端旧值覆盖回来。 */
  const reset = useCallback(() => {
    notif.reset();
    void pushAccountFields(accountFieldsOf(DEFAULT_NOTIFY_SETTINGS));
  }, [notif, pushAccountFields]);

  return { ...notif, setPrivate, setGroup, setBadge, reset, syncAfterLogin, onServerVersionBump };
}
