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
