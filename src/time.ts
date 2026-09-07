// 全站统一的时间格式化：会话列表时间、聊天消息时间等“显示时分”的地方都复用本方法。
// fmt 来自"通用设置 ▸ 时间格式"（12/24 小时制）。

export type TimeFormat = "12" | "24";

/** 把毫秒时间戳格式化为时分。24 小时制 = "HH:mm"；12 小时制 = "h:mm AM/PM"。 */
export function formatTime(ts: number, fmt: TimeFormat = "24"): string {
  if (!ts) return "";
  const d = new Date(ts);
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (fmt === "12") {
    const h = d.getHours();
    const period = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mm} ${period}`;
  }
  return `${String(d.getHours()).padStart(2, "0")}:${mm}`;
}

// 两个毫秒时间戳是否同一自然日（聊天页按日期分组用）。
export function isSameDay(a: number, b: number): boolean {
  if (!a || !b) return false;
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/**
 * 会话列表右侧时间：**四段式**——今天 `HH:mm` / 昨天「昨天」/ 今年 `M月d日` / 更早 `yyyy年M月d日`。
 *
 * 基准见 IMServer `docs/UI_SPEC.md` §5.1（2026-09-07 三端拍板）。
 * **旧行为是 bug**：这里原先直接用 formatTime，上周的消息显示成 `14:30`，
 * 用户分不出"刚刚"和"上周"——iOS 用 MM-dd、Android 用四段式，只有 Web 完全不区分日期。
 *
 * 与 dayHeader 刻意共用同一套词汇（用户只学一次），差别只在今天那一段：
 * 这里给时分（且**跟随 12/24 小时制设置**），dayHeader 给「今天」。
 *
 * 对端实现：IMProgram IMTheme 的 conversationTimeStringFromMillis:、
 * im-android TimeFormat.conversationTime()。
 */
export function conversationTime(ts: number, fmt: TimeFormat = "24"): string {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  if (isSameDay(ts, now.getTime())) return formatTime(ts, fmt);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (isSameDay(ts, yesterday.getTime())) return "昨天";
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// 毫秒时间戳 → 日期分隔文案：今天/昨天/M月d日（今年）/yyyy年M月d日（往年）。
export function dayHeader(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (isSameDay(ts, now.getTime())) return "今天";
  if (isSameDay(ts, yesterday.getTime())) return "昨天";
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
