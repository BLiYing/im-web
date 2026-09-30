// 账号级通知设置同步的纯逻辑（M5）：wire 映射 + 登录/重连动作判定 + 帧版本比对。
// 无 React、无网络、无 localStorage——全部可在 vitest 里直接断言，副作用交给 useAccountNotifySettings.ts。
//
// 背景：NOTIFICATIONS_DESIGN 把 private/group/badge.includeMuted 从「每设备本地」迁到「账号级、服务端存储、
// 多端同步」（PROTOCOL.md §6.13 + PUSH_M5_DESIGN.md §3.3）；inApp.*/desktop.* 仍每设备本地，不动。
// **iOS `IMNotificationSettings`、Android 同名类实现同一套逻辑**——改这份文件的判定要三端一起看。
import { normalizeSoundId, type NotifySettings, type NotifyTypeSettings } from "./notifySettings";

/** 账号级三项的本地表示（NotifySettings 的子集，字段命名沿用本地驼峰）。 */
export type AccountNotifyFields = Pick<NotifySettings, "private" | "group" | "badge">;

/** wire 上的单个分类（private/group），字段名与本地一致，只是不含 TS 的 NotifySoundId 字面量约束。 */
export interface NotifyTypeWire {
  enabled: boolean;
  preview: boolean;
  sound: string;
}

/** wire 契约（PROTOCOL §6.13）：`badge.include_muted` 是蛇形命名，本地是 `badge.includeMuted`。 */
export interface NotifySettingsWire {
  private: NotifyTypeWire;
  group: NotifyTypeWire;
  badge: { include_muted: boolean };
}

function typeToWire(t: NotifyTypeSettings): NotifyTypeWire {
  return { enabled: t.enabled, preview: t.preview, sound: t.sound };
}

/** 解析服务端某个分类字段；非法/缺失逐字段回落 fallback（对齐 notifySettings.ts#normalizeType 的 per-field 口径）。 */
function typeFromWire(raw: unknown, fallback: NotifyTypeSettings): NotifyTypeSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : fallback.enabled,
    preview: typeof o.preview === "boolean" ? o.preview : fallback.preview,
    sound: "sound" in o ? normalizeSoundId(o.sound) : fallback.sound,
  };
}

/** 本地账号级字段 → wire（PUT 请求体，就是 settings 本身，不再包一层）。 */
export function accountFieldsToWire(f: AccountNotifyFields): NotifySettingsWire {
  return {
    private: typeToWire(f.private),
    group: typeToWire(f.group),
    badge: { include_muted: f.badge.includeMuted },
  };
}

/** wire（GET/PUT 响应里的 `settings` 块）→ 本地账号级字段；非法/缺失逐字段回落 fallback，绝不抛。 */
export function accountFieldsFromWire(raw: unknown, fallback: AccountNotifyFields): AccountNotifyFields {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const badge = (o.badge && typeof o.badge === "object" ? o.badge : {}) as Record<string, unknown>;
  return {
    private: typeFromWire(o.private, fallback.private),
    group: typeFromWire(o.group, fallback.group),
    badge: { includeMuted: typeof badge.include_muted === "boolean" ? badge.include_muted : fallback.badge.includeMuted },
  };
}

/**
 * 登录/重连时该做什么（PROTOCOL §6.13：「首次遇到时把本地现值 PUT 上去…之后一律以服务端为准」+
 * 本端补的「PUT 失败保留本地、标脏、下次重试」）：
 * - `dirty`（上次本地编辑的 PUT 还没成功送达）优先**重试推送**——绝不能被一次 GET 覆盖掉用户还没确认送达的编辑。
 * - 不 dirty 时：`exists=false` → 迁移，把本地现值推一次；`exists=true` → 服务端覆盖本地。
 */
export type LoginSyncAction = "retry_push" | "migrate_push" | "overwrite_local";

export function decideLoginSync(dirty: boolean, exists: boolean): LoginSyncAction {
  if (dirty) return "retry_push";
  return exists ? "overwrite_local" : "migrate_push";
}

/** `notify_settings_update` 帧到达时是否要重新 GET：只在帧带的版本号比本地记的新时才拉，避免多端来回互推。 */
export function shouldRefetchOnFrame(frameVersion: number, localVersion: number): boolean {
  return frameVersion > localVersion;
}
