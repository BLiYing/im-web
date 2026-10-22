// 自动删除消息（v2：会话级共享、不追溯）的纯逻辑：过期判定、档位、确认规则、清理规划。
// 契约 IMServer/docs/design/AUTO_DELETE_DESIGN.md；共用向量 conformance/auto_delete.json（本地副本
// testing/autoDelete.vectors.json）。三端同名口径：iOS IMAutoDelete*、Android AutoDelete.kt。
// 本文件不碰 React / IO；有状态的触发与执行在 useAutoDelete.ts。
import type { ChatMessage, ConvLastMessage, Conversation } from "./sdk/protocol";
import { countsAsUnread } from "./mention";

const DAY = 86400;
/** 档位白名单（秒）：关 + 18 档（2 分钟 … 1 年；月=30 天、年=365 天），升序。与共用向量 valid_sec 一致。 */
export const AUTO_DELETE_TIERS = [
  0, 120, 3600, DAY, 2 * DAY, 3 * DAY, 4 * DAY, 5 * DAY, 6 * DAY, 7 * DAY, 14 * DAY, 21 * DAY,
  30 * DAY, 60 * DAY, 90 * DAY, 120 * DAY, 150 * DAY, 180 * DAY, 365 * DAY,
] as const;
export type AutoDeleteSec = (typeof AUTO_DELETE_TIERS)[number];
/** 「自定义」弹窗的 18 档（不含关闭）。 */
export const AUTO_DELETE_CUSTOM_TIERS: readonly number[] = AUTO_DELETE_TIERS.slice(1);
/** 选择页固定行：关闭 / 2 分钟 / 1 天 / 1 周 / 1 个月（其余档位走「自定义」）。 */
export const AUTO_DELETE_FIXED_TIERS: readonly number[] = [0, 120, DAY, 7 * DAY, 30 * DAY];
/** 当前档位落在「自定义」行（✓ 与右值归它）：非固定档（含 1 小时等弹窗档）。 */
export const isCustomTier = (sec: number): boolean => !AUTO_DELETE_FIXED_TIERS.includes(sec);

/** 会话级自动删除状态：档位 + 计时起点（毫秒，= 服务端 auto_delete_from；sec=0 时 0）。两个字段永远一起读写。 */
export interface AutoDeleteState { sec: number; from: number }
/** 解析层防御：sec>0 却 from<=0 是脏数据（服务端恒下发 from=系统消息时间+1>0），按关闭，避免从 1970 起追溯清空。 */
export const sanitizeState = (sec: number, from: number): AutoDeleteState => (sec > 0 && !(from > 0) ? { sec: 0, from: 0 } : { sec, from });
export const stateOf = (c: Pick<Conversation, "auto_delete_sec" | "auto_delete_from">): AutoDeleteState =>
  sanitizeState(c.auto_delete_sec ?? 0, c.auto_delete_from ?? 0);

/** 过期（v2，含等号）：sec>0 && ts>=from && ts + sec*1000 <= now；sec<=0 恒不过期；from 之前永不过期（不追溯）。 */
export function expired(ts: number, sec: number, from: number, now: number): boolean {
  return sec > 0 && ts >= from && ts + sec * 1000 <= now;
}

/** 过期时间窗口 [from, now-sec*1000]（ts 落在其中即过期）；sec<=0 或窗口为空（hi<lo）→ null。 */
export function expiryWindow(sec: number, from: number, now: number): { lo: number; hi: number } | null {
  if (!(sec > 0)) return null;
  const hi = now - sec * 1000;
  return hi < from ? null : { lo: from, hi };
}

/** 档位变更系统消息（timestamp=sysTs）生效的 from：sysTs+1（通知自己不过期）；关闭为 0。 */
export const fromAfterSystemMessage = (sysTs: number, sec: number): number => (sec > 0 ? sysTs + 1 : 0);

/** 本地会话缓存迁移：v1 缓存里的个人档位（有 auto_delete_sec、没有 auto_delete_from 字段）不迁移，读出时清零——
 *  否则冷启动在列表重拉前会拿 from=0 当 v2 状态扫描，等于追溯清空全部历史。v2 缓存恒带 auto_delete_from。 */
export function dropV1AutoDelete(c: Conversation): Conversation {
  return (c.auto_delete_sec ?? 0) > 0 && !((c.auto_delete_from ?? 0) > 0) ? { ...c, auto_delete_sec: 0, auto_delete_from: 0 } : c;
}

/** 时长折算（优先级自上而下）：整除 365 天→年；30 天→月；7 天→周；1 天→天；1 小时→小时；否则分钟（向上取整）。 */
export function tierUnit(sec: number): { key: string; count: number } {
  const units: [number, string][] = [[365 * DAY, "year"], [30 * DAY, "month"], [7 * DAY, "week"], [DAY, "day"], [3600, "hour"]];
  for (const [size, name] of units) if (sec > 0 && sec % size === 0) return { key: `autodel.unit.${name}`, count: sec / size };
  return { key: "autodel.unit.minute", count: Math.max(1, Math.ceil(sec / 60)) };
}

/** 档位 → 展示文案（0 / 负值 / 脏数据 ≤0 → 「关闭」）；也是确认框 `{period}` 的取值（目标档位恒 >0）。 */
export function tierLabel(t: (key: string, args?: Record<string, string | number>) => string, sec: number): string {
  if (!(sec > 0)) return t("common.off");
  const { key, count } = tierUnit(sec);
  return t(key, { count });
}

/** 会话级改档位是否要先弹说明性确认：新档位>0 且 ≠ 当前（开启 / 改档位各弹一次）；关闭 / 不变不弹。非 destructive（不追溯）。 */
export function needsConfirm(oldSec: number, newSec: number): boolean {
  return newSec > 0 && newSec !== oldSec;
}

/** 一个会话当前内存消息里该清的 conv_seq（只看已确认入库的；convSeq=0 的发送中 / 失败行不动）。 */
export function expiredSeqs(msgs: readonly ChatMessage[], ad: AutoDeleteState, now: number): number[] {
  if (ad.sec <= 0) return [];
  return msgs.filter((m) => m.convSeq > 0 && expired(m.timestamp, ad.sec, ad.from, now)).map((m) => m.convSeq);
}

/** 幸存消息 → 列表预览用的最后一条（字段与 `ConvLastMessage` 对齐；服务端下次刷新会给权威值）。 */
function toLastMessage(m: ChatMessage): ConvLastMessage {
  return {
    server_msg_id: m.serverMsgId ?? "", from: m.from, from_nickname: m.fromNickname, content_type: m.contentType,
    content: m.content, caption: m.caption, duration: m.duration, conv_seq: m.convSeq, timestamp: m.timestamp,
    recalled_at: m.recalledAt, sys_segments: m.sysSegments, sys_event: m.sysEvent, sys_args: m.sysArgs,
  };
}

/**
 * 清理之后本地重算会话行：预览 = **最后一条未过期的可见消息**（口径同服务端 lastVisible：跳过 msg_op 事件行，
 * 越过过期窗口继续往前，`from` 之前的消息仍可作预览），没有则空；未读 = 扣掉被清掉的他人未读，预览空时归 0。
 * 会话行保留且不重排（顺序来自服务端）。末条是否「被清」= 在 removed 里，或按本机时钟已过期——后者覆盖末条不在
 * 内存窗口的情形（刷新后墓碑过滤、缓存里的旧预览、列表刷新带回的旧预览）。候选只取内存里的幸存消息：
 * 内存窗口没载到 from 之前的老消息时预览暂空，随后列表刷新带回服务端权威值。
 * 没变化时原样返回同一对象（调用方据此判断是否需要写缓存）。
 */
export function patchConvAfterSweep(
  c: Conversation, removed: readonly ChatMessage[], survivors: readonly ChatMessage[], uid: string,
  ad: AutoDeleteState = { sec: 0, from: 0 }, now = Date.now(),
): Conversation {
  const gone = new Set(removed.map((m) => m.convSeq));
  const unreadGone = removed.filter((m) => m.from !== uid && countsAsUnread(m.contentType) && m.convSeq > (c.read_seq ?? 0)).length;
  const lm = c.last_message;
  const lastGone = !!lm && (gone.has(lm.conv_seq) || expired(lm.timestamp, ad.sec, ad.from, now));
  if (!lastGone && unreadGone === 0) return c;
  let last = lm;
  if (lastGone) {
    const tail = survivors
      .filter((m) => m.convSeq > 0 && m.contentType !== "msg_op" && !gone.has(m.convSeq) && !expired(m.timestamp, ad.sec, ad.from, now))
      .sort((a, b) => b.convSeq - a.convSeq)[0];
    last = tail ? toLastMessage(tail) : null;
  }
  const unread = last ? Math.max(0, (c.unread ?? 0) - unreadGone) : 0;
  return { ...c, last_message: last, unread };
}
