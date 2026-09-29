// Web 标签页未读角标（NOTIFICATIONS_P1_DESIGN.md §3）：canvas 在原 favicon 上画右上角红底白字角标，
// 数字与底部「消息」页签同一个 `badgeCountOf`（跟随「包含免打扰会话」开关）；只有「标记未读」没有
// 数字时画红点；为 0 时恢复原图标/标题。**仅浏览器版生效**（桌面客户端已有 Dock/任务栏角标，见
// `useFaviconBadge.ts` 的 `platform().isDesktop` 闸门，本文件不做平台判断）。
//
// 状态计算（count/hasMarkedUnread → none/dot/number）是纯函数，配单测；下面的 canvas/DOM 绘制会摸
// `<canvas>`/`<link>`/`Image`，jsdom 画不出真像素，不在单测范围（与聊天滚动定位类改动同一处境，
// 见 CODING_STYLE §八）。
import type { Conversation } from "./sdk/protocol";

export type FaviconBadgeState =
  | { kind: "none" }
  | { kind: "dot" }
  | { kind: "number"; label: string };

/** 超过 99 显示 "99+"；负数/小数防御性收成 0（badgeCountOf 不应给出，仍兜底）。 */
export function faviconBadgeLabel(count: number): string {
  const n = Math.max(0, Math.trunc(count));
  return n > 99 ? "99+" : String(n);
}

/** 角标状态：有未读数字优先画数字；数字为 0 但有会话被标记未读 → 红点；否则恢复原图标。 */
export function faviconBadgeState(count: number, hasMarkedUnread: boolean): FaviconBadgeState {
  if (count > 0) return { kind: "number", label: faviconBadgeLabel(count) };
  return hasMarkedUnread ? { kind: "dot" } : { kind: "none" };
}

/** 是否有会话被手动标为未读（红点无数字场景）；不看是否免打扰——与会话列表本身的红点显隐口径一致
 *  （`App.tsx` 的 `c.marked_unread` 判断同样不过滤免打扰，只是渲染时加一档 `muted` 灰色）。 */
export function hasMarkedUnreadConv(convs: readonly Conversation[]): boolean {
  return convs.some((c) => !!c.marked_unread);
}

/** 标题前缀：只有数字角标才加 "(n) "；红点/无角标恢复原标题（§3：「为 0 或只有红点时恢复原标题」）。 */
export function faviconTitleOf(state: FaviconBadgeState, baseTitle: string): string {
  return state.kind === "number" ? `(${state.label}) ${baseTitle}` : baseTitle;
}

/** 去重 key：同一状态不重画（§3：「数字不变不重画」，红点/none 也一并按这条走）。 */
export function faviconBadgeKey(state: FaviconBadgeState): string {
  return state.kind === "number" ? `number:${state.label}` : state.kind;
}

/** 与 UI_COLOR.md `--danger` 令牌浅色取值一致的兜底常量（canvas 无法可靠拿到 CSS 变量时用）：
 *  绘制时优先读 `getComputedStyle(document.documentElement)` 的实际值（跟着深浅色主题走），
 *  取不到（非浏览器环境、变量未声明）才退回这个常量。 */
export const FAVICON_BADGE_FALLBACK_COLOR = "#e5484d";

function readBadgeColor(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--danger").trim();
    return v || FAVICON_BADGE_FALLBACK_COLOR;
  } catch {
    return FAVICON_BADGE_FALLBACK_COLOR;
  }
}

/** 找 `index.html` 里声明的 `<link rel="icon">`；理论上总能找到（index.html 静态声明），
 *  找不到时新建一个塞进 `<head>` 兜底，不让角标功能因为缺一个标签整个哑掉。 */
function faviconLinkEl(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
}

let originalHref: string | null = null;

/** 仅供测试：清掉「已记住的原始 favicon」缓存，避免用例之间串扰。 */
export function resetFaviconBadgeForTests(): void {
  originalHref = null;
}

/** 画一枚角标覆盖在原 favicon 上，把结果塞进 `<link rel="icon">` 的 href；
 *  `state.kind==="none"` 时恢复成第一次记下来的原始 href。异步（`Image` 解码），
 *  调用方不需要等待——画完自己把 href 换上去，中途状态再变会被下一次调用覆盖。 */
export function drawFaviconBadge(state: FaviconBadgeState): void {
  const link = faviconLinkEl();
  if (originalHref === null) originalHref = link.href; // 只记第一次：originalHref 之后不再更新

  if (state.kind === "none") {
    link.href = originalHref;
    return;
  }

  const img = new Image();
  img.onload = () => {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);

    const color = readBadgeColor();
    if (state.kind === "dot") {
      ctx.beginPath();
      ctx.arc(size - 11, 11, 10, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      const wide = state.label.length > 2; // "99+" 三字符比两位数宽，胶囊拉宽而不是挤字号
      const r = 13;
      const w = wide ? r * 2 + 12 : r * 2;
      const cx = size - w / 2 - 1;
      const cy = r + 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(cx - w / 2, cy - r, w, r * 2, r);
      } else {
        ctx.arc(cx, cy, r, 0, Math.PI * 2); // 极老浏览器兜底：退化成圆
      }
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${wide ? 13 : 15}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(state.label, cx, cy + 1);
    }
    link.href = canvas.toDataURL("image/png");
  };
  img.src = originalHref;
}
