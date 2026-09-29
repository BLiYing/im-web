/**
 * 消息列表滚动条滑块的位置与高度（六条用户报告第 6 项）。
 *
 * Web 有真实的 scrollHeight/clientHeight，不必像 Android（Compose LazyColumn 拿不到真实内容
 * 总高，只能用可见行平均高估算，见 `ChatScroll.kt` 的 `scrollbarThumb`）那样估算——判据更简单，
 * 但"要不要显示滑块 / 滑块高度不低于最小可视高度"这两条不变式两端一致。
 */

/** 滑块最矮几像素——内容特别长时，按比例算出来的滑块会细到看不见（同 Android SCROLLBAR_MIN_THUMB_PX）。 */
export const SCROLLBAR_MIN_THUMB_PX = 24;

export type ScrollbarThumb = { top: number; height: number };

/** @returns null = 一屏放得下全部内容，不必画滑块 */
export function scrollbarThumb(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): ScrollbarThumb | null {
  if (clientHeight <= 0 || scrollHeight <= clientHeight) return null;
  const thumbHeight = Math.min(
    Math.max((clientHeight * clientHeight) / scrollHeight, SCROLLBAR_MIN_THUMB_PX),
    clientHeight,
  );
  const maxScrollTop = scrollHeight - clientHeight;
  const maxTravel = clientHeight - thumbHeight;
  const progress = maxScrollTop > 0 ? scrollTop / maxScrollTop : 0;
  return { top: maxTravel * Math.min(Math.max(progress, 0), 1), height: thumbHeight };
}
