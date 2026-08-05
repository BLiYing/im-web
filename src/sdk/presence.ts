/** 在线态（对齐后端 protocol.Presence* 的租约模型，2026-08-05，与 iOS IMPresence 同构）。
 *
 *  设计要点：服务端只推「上线」，不推「下线」——在线与否由 online_until 到期本地判定。
 *  好处是漏收一帧不会让状态永久陈旧，代价是对端离开后「在线」最长残留一个租约周期（约 5 分钟）。
 *  故 isOnline 必须**每次读取时按当前时间重算**，不能缓存成 boolean。 */

/** 在线态粗档（对齐后端 protocol.Presence* 字符串）。 */
export type PresenceLevel = "online" | "recently" | "last_week" | "last_month" | "long_ago";

/** 一个用户的在线态快照。 */
export interface Presence {
  level?: PresenceLevel;
  onlineUntil: number; // 在线租约到期（毫秒）；0=无租约
  lastSeen: number; // 最后在线（毫秒）；0=未知/不可见
}

const LEVELS: readonly string[] = ["online", "recently", "last_week", "last_month", "long_ago"];

/** 脏数据安全的档位解析：非法值 → undefined（未知）。 */
function toLevel(v: unknown): PresenceLevel | undefined {
  return typeof v === "string" && LEVELS.includes(v) ? (v as PresenceLevel) : undefined;
}

/** 脏数据安全的数字解析：非有限数 → 0。 */
function toMillis(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 空态（未取到快照）：不在线、无文案。 */
export const EMPTY_PRESENCE: Presence = { onlineUntil: 0, lastSeen: 0 };

/** 从会话列表项解析（键 peer_presence / peer_online_until / peer_last_seen）。 */
export function presenceFromConversation(c: unknown): Presence {
  const d = (c ?? {}) as Record<string, unknown>;
  return {
    level: toLevel(d.peer_presence),
    onlineUntil: toMillis(d.peer_online_until),
    lastSeen: toMillis(d.peer_last_seen),
  };
}

/** 从 presence 帧 / 资料卡解析（键 status|presence / online_until / last_seen）。 */
export function presenceFromFrame(d: unknown): Presence {
  const o = (d ?? {}) as Record<string, unknown>;
  return {
    level: toLevel(o.status) ?? toLevel(o.presence),
    onlineUntil: toMillis(o.online_until),
    lastSeen: toMillis(o.last_seen),
  };
}

/** 当前是否在线：按**此刻**与租约比较（租约到期即自动降级，无需服务端下线帧）。 */
export function isOnline(p: Presence | undefined, now = Date.now()): boolean {
  return !!p && p.onlineUntil > now;
}

/** 标题栏副标题文案：在线 / 刚刚在线 / N 分钟前 / 今天 HH:mm / 昨天 HH:mm / M月d日…
 *  取不到任何信息时返回空串（调用方据此隐藏副标题，不显示占位）。 */
export function presenceText(p: Presence | undefined, now = Date.now()): string {
  if (!p) return "";
  if (isOnline(p, now)) return "在线";
  if (p.lastSeen > 0) return relativeLastSeen(p.lastSeen, now);
  // 无精确时间（未知或将来被隐私设置抹掉）时回退到粗档文案。
  switch (p.level) {
    // 档位说 online 但租约已过期/缺失：**不能**显示「在线」——没有租约就没有到期时刻，
    // 这个「在线」再也不会被时间推翻，会永久停在错误状态。从宽也只到「最近在线」。
    case "online":
      return "最近在线";
    case "recently":
      return "最近在线";
    case "last_week":
      return "一周内在线";
    case "last_month":
      return "一个月内在线";
    case "long_ago":
      return "很久未上线";
    default:
      return "";
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 由 lastSeen 生成精确相对文案（与 iOS IMPresence 的分级一致）。 */
function relativeLastSeen(lastSeen: number, now: number): string {
  const elapsed = (now - lastSeen) / 1000;
  if (elapsed < 60) return "刚刚在线";
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)} 分钟前在线`;

  const seen = new Date(lastSeen);
  const hhmm = `${pad2(seen.getHours())}:${pad2(seen.getMinutes())}`;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  if (lastSeen >= dayStart.getTime()) return `今天 ${hhmm} 在线`;
  if (lastSeen >= dayStart.getTime() - 86_400_000) return `昨天 ${hhmm} 在线`;

  // 跨年时带上年份，避免「1月2日」指向去年却看不出来。
  const sameYear = seen.getFullYear() === new Date(now).getFullYear();
  const date = `${seen.getMonth() + 1}月${seen.getDate()}日`;
  return sameYear ? `${date} 在线` : `${seen.getFullYear()}年${date} 在线`;
}
