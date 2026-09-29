// 定时免打扰（通知第二期 · 第二批，NOTIFICATIONS_P1_DESIGN.md §4.3）三端同名纯函数。
// **所有**过去直接读 `muted` 的地方都要换成 isMutedNow（见 §6.4 清单：列表铃铛/未读变灰、
// badgeCountOf、notifyInbound、例外列表过滤、选择页过滤、ChatHeader/DetailPanel 状态……），
// 漏一处就是「这里显示免打扰、那里照样响」——SYMMETRY.md 已登记本文件，对端 im-android
// data/MuteState.kt、iOS IMMuteState.*；向量 docs/conformance/mute_state.json（本地拷贝
// testing/muteState.vectors.json，drift 由 muteState.test.ts 兜底）。
import { t as i18nT } from "./i18n";
import { monthDay } from "./time";

/** 有效免打扰：`muted` 为真，且到期时间为 0（永久）或还没到。**到期由客户端自己判**——
 *  服务端不推到期帧，`now == until` 视为已解除（与服务端 conversation.EffectiveMute 同）。 */
export function isMutedNow(muted: boolean, muteUntilMs: number | undefined, nowMs: number): boolean {
  const until = muteUntilMs ?? 0;
  return muted && (until === 0 || nowMs < until);
}

/** 到期文案的分类结果：`forever`（永久，无 time/month/day）；`today`/`tomorrow`（同 time:"HH:mm"）；
 *  `date`（更晚，month 1-12 + day，用 Intl 本地化月份见 `time.ts#monthDay`）。 */
export type MuteUntilLabel =
  | { kind: "forever"; time: null; month: null; day: null }
  | { kind: "today" | "tomorrow"; time: string; month: null; day: null }
  | { kind: "date"; time: null; month: number; day: number };

/**
 * 按 `tzOffsetMinutes`（东八区=480，UTC-5=-300，即 `-new Date().getTimezoneOffset()` 的口径）
 * 把 `muteUntilMs` 分类成「今天/明天/更晚的日期/永久」，按**日历日**而非固定 24h 判断
 * （「后天零点」离 now 可能不到 48h，但已经是第三个自然日，不是 tomorrow）。
 * 只对**有效免打扰**（`isMutedNow` 为真）时调用有意义；`muteUntilMs=0` 恒 forever。
 */
export function muteUntilLabel(muteUntilMs: number, nowMs: number, tzOffsetMinutes: number): MuteUntilLabel {
  if (!muteUntilMs) return { kind: "forever", time: null, month: null, day: null };
  const untilLocal = muteUntilMs + tzOffsetMinutes * 60_000;
  const nowLocal = nowMs + tzOffsetMinutes * 60_000;
  const ud = new Date(untilLocal);
  const nd = new Date(nowLocal);
  // 用 UTC getter 读「已按 tzOffsetMinutes 平移过」的时间戳，不依赖宿主机自己的时区设置
  // （否则测试在不同 CI 时区下会得到不同结果——这正是 vectors 要求「takes a tz offset for testability」的原因）。
  const untilDay = Date.UTC(ud.getUTCFullYear(), ud.getUTCMonth(), ud.getUTCDate());
  const nowDay = Date.UTC(nd.getUTCFullYear(), nd.getUTCMonth(), nd.getUTCDate());
  const dayDiff = Math.round((untilDay - nowDay) / 86_400_000);
  const time = `${String(ud.getUTCHours()).padStart(2, "0")}:${String(ud.getUTCMinutes()).padStart(2, "0")}`;
  if (dayDiff === 0) return { kind: "today", time, month: null, day: null };
  if (dayDiff === 1) return { kind: "tomorrow", time, month: null, day: null };
  return { kind: "date", time: null, month: ud.getUTCMonth() + 1, day: ud.getUTCDate() };
}

/** 时长菜单（NOTIFICATIONS_P1_DESIGN §4.1，已拍板③④）：1 小时/8 小时/1 天/7 天/永久，不做自定义到某天。 */
export type MuteDurationId = "1h" | "8h" | "1d" | "7d" | "forever";
export const MUTE_DURATION_OPTIONS: readonly { id: MuteDurationId; labelKey: string; hours: number }[] = [
  { id: "1h", labelKey: "mute.1h", hours: 1 },
  { id: "8h", labelKey: "mute.8h", hours: 8 },
  { id: "1d", labelKey: "mute.1d", hours: 24 },
  { id: "7d", labelKey: "mute.7d", hours: 24 * 7 },
  { id: "forever", labelKey: "common.permanent", hours: 0 },
];

/** 时长选项 → `mute_until` 绝对时间戳（`now` 用客户端当前时间算出再发给服务端，§4.1）；永久 = 0。 */
export function muteUntilForDuration(id: MuteDurationId, nowMs: number): number {
  if (id === "forever") return 0;
  const opt = MUTE_DURATION_OPTIONS.find((o) => o.id === id);
  return nowMs + (opt?.hours ?? 0) * 3_600_000;
}

/** 本机时区偏移（分钟，东八区=480）：`-getTimezoneOffset()` 与向量的 tzOffsetMinutes 同一符号约定。 */
function localTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/**
 * 「至今天 18:30」/「至明天 18:30」/「至 10月3日」/「永久」——DetailPanel 免打扰行右值同款文案。
 * `date` 分类的月份走 `time.ts#monthDay`（en 给英文缩写、zh 给数字，Intl 本地化，与会话列表时间戳同一套）。
 */
export function muteUntilText(muteUntilMs: number, nowMs: number = Date.now(), tzOffsetMinutes: number = localTzOffsetMinutes()): string {
  const label = muteUntilLabel(muteUntilMs, nowMs, tzOffsetMinutes);
  if (label.kind === "forever") return i18nT("common.permanent");
  if (label.kind === "today") return i18nT("notif.mute.until_today", { time: label.time });
  if (label.kind === "tomorrow") return i18nT("notif.mute.until_tomorrow", { time: label.time });
  return i18nT("notif.mute.until_date", { date: monthDay(new Date(muteUntilMs)) });
}

/**
 * 同上但**不含「永久」分支**——供例外列表副标题 `notif.exceptions.muted_until{until}` 拼接用：
 * 调用方需先判断 `muteUntilMs===0` 走 `notif.exceptions.muted`（不带 until），非 0 才调本函数取 `{until}` 片段。
 */
export function muteUntilPhrase(muteUntilMs: number, nowMs: number = Date.now(), tzOffsetMinutes: number = localTzOffsetMinutes()): string {
  const label = muteUntilLabel(muteUntilMs, nowMs, tzOffsetMinutes);
  if (label.kind === "forever") return "";
  if (label.kind === "today") return i18nT("notif.mute.until_today", { time: label.time });
  if (label.kind === "tomorrow") return i18nT("notif.mute.until_tomorrow", { time: label.time });
  return i18nT("notif.mute.until_date", { date: monthDay(new Date(muteUntilMs)) });
}
