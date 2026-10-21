// 自动删除消息（个人级，只影响本人视图）的纯逻辑：过期判定、档位、确认规则、清理规划。
// 契约 IMServer/docs/design/AUTO_DELETE_DESIGN.md；共用向量 conformance/auto_delete.json（本地副本
// testing/autoDelete.vectors.json）。三端同名口径：iOS IMAutoDelete*、Android AutoDelete.kt。
// 本文件不碰 React / IO；有状态的触发与执行在 useAutoDelete.ts。
import type { ChatMessage, ConvLastMessage, Conversation } from "./sdk/protocol";
import { countsAsUnread } from "./mention";

/** 档位白名单（秒）：关 / 1 天 / 1 周 / 1 个月（30 天）。 */
export const AUTO_DELETE_TIERS = [0, 86400, 604800, 2592000] as const;
export type AutoDeleteSec = (typeof AUTO_DELETE_TIERS)[number];

/** 过期：sec>0 且 ts + sec*1000 <= now（含等号）；sec<=0 恒不过期。 */
export function expired(ts: number, sec: number, now: number): boolean {
  return sec > 0 && ts + sec * 1000 <= now;
}

/** 时间下界：timestamp <= floorTs 即过期；sec<=0 为 0（不过滤）。 */
export function floorTs(sec: number, now: number): number {
  return sec > 0 ? Math.max(0, now - sec * 1000) : 0;
}

/** 档位 → 文案键（未知值按「关闭」兜底，老服务端 / 脏数据不至于显示空白）。 */
export function tierLabelKey(sec: number): string {
  switch (sec) {
    case 86400: return "autodel.day";
    case 604800: return "autodel.week";
    case 2592000: return "autodel.month";
    default: return "common.off";
  }
}

/** 档位 → 确认框 `{period}` 的文案键（只有开启 / 缩短才会弹，目标档位恒 >0）。 */
export const periodKey = tierLabelKey;

/** 会话级改档位是否要先弹 destructive 确认：新档位>0 且（旧=关 或 新<旧）。关闭 / 放宽 / 不变都不弹。 */
export function needsConfirm(oldSec: number, newSec: number): boolean {
  return newSec > 0 && (oldSec <= 0 || newSec < oldSec);
}

/** 一个会话当前内存消息里该清的 conv_seq（只看已确认入库的；convSeq=0 的发送中 / 失败行不动）。 */
export function expiredSeqs(msgs: readonly ChatMessage[], sec: number, now: number): number[] {
  if (sec <= 0) return [];
  return msgs.filter((m) => m.convSeq > 0 && expired(m.timestamp, sec, now)).map((m) => m.convSeq);
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
 * 清理之后本地重算会话行：预览 = 剩余最后一条（没有则空）；未读 = 扣掉被清掉的他人未读。会话行保留。
 * 只在末条被清时才动预览，避免用内存里不完整的窗口覆盖掉服务端给的权威末条。
 */
export function patchConvAfterSweep(c: Conversation, removed: readonly ChatMessage[], survivors: readonly ChatMessage[], uid: string): Conversation {
  const gone = new Set(removed.map((m) => m.convSeq));
  const unreadGone = removed.filter((m) => m.from !== uid && countsAsUnread(m.contentType) && m.convSeq > (c.read_seq ?? 0)).length;
  const lastGone = !!c.last_message && gone.has(c.last_message.conv_seq);
  let last = c.last_message;
  if (lastGone) {
    const tail = survivors.filter((m) => m.convSeq > 0).sort((a, b) => b.convSeq - a.convSeq)[0];
    last = tail ? toLastMessage(tail) : null;
  }
  return { ...c, last_message: last, unread: Math.max(0, (c.unread ?? 0) - unreadGone) };
}
