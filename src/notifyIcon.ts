// 桌面系统通知里的会话头像（2026-10-01，补齐与手机端的差距）。
//
// 口径与 iOS / Android 通知一致（`../IMServer/docs/design/PUSH_M5_DESIGN.md`）：
// **群聊只用群自己的头像**（没有就用按群播种的占位），**单聊只用对端的**——不拿发送人头像顶替群头像。
// 占位与会话列表那颗首字母圈同色同字（`avatarColor` / `avatarInitial`，三端同算法）。
//
// 画成圆形 PNG 的 data: URL 交给主进程（`nativeImage.createFromDataURL`）：主进程不必自己再去下载、
// 也拿不到页面的 origin，而页面这边浏览器缓存里多半已经有这张头像。
import type { Conversation } from "./sdk/protocol";
import { SYSTEM_UID } from "./sdk/protocol";
import { avatarColor, avatarInitial } from "./components/Avatar";

export interface NotifyIconSource {
  url?: string;
  label: string;
  seed: string;
}

/** 这条通知该用谁的头像。系统通知会话返回 null：用应用图标即可（它的头像本来就是应用 logo）。 */
export function notifyIconSource(conv: Conversation | undefined, convId: string, label: string): NotifyIconSource | null {
  if (!conv) return { label, seed: convId };
  if (conv.is_group) return { url: conv.avatar_url || undefined, label, seed: conv.conv_id };
  if (conv.peer === SYSTEM_UID) return null;
  return { url: conv.peer_avatar_url || undefined, label, seed: conv.peer };
}

const SIZE = 128;
/** 等头像图片的上限：超过就先用占位弹出去——通知晚到比没有头像更糟。 */
const LOAD_TIMEOUT_MS = 1500;
const CACHE_MAX = 64;
const cache = new Map<string, string>();

function remember(key: string, dataUrl: string): void {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, dataUrl);
}

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = canvas.getContext("2d"); } catch { ctx = null; }
  if (!ctx) return null;
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  return { canvas, ctx };
}

function placeholder(src: NotifyIconSource): string | undefined {
  const c = newCanvas();
  if (!c) return undefined;
  c.ctx.fillStyle = avatarColor(src.seed);
  c.ctx.fillRect(0, 0, SIZE, SIZE);
  c.ctx.fillStyle = "#fff";
  c.ctx.font = `600 ${SIZE * 0.42}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  c.ctx.textAlign = "center";
  c.ctx.textBaseline = "middle";
  c.ctx.fillText(avatarInitial(src.label), SIZE / 2, SIZE / 2 + SIZE * 0.03);
  return c.canvas.toDataURL("image/png");
}

function fromImage(img: HTMLImageElement): string | undefined {
  const c = newCanvas();
  if (!c) return undefined;
  c.ctx.drawImage(img, 0, 0, SIZE, SIZE);
  try {
    return c.canvas.toDataURL("image/png");
  } catch {
    return undefined;   // 跨域且服务端没给 CORS → canvas 被污染，读不出来：调用方退回占位
  }
}

/**
 * 算出通知头像并交给 `deliver`。**能同步就同步**（命中缓存 / 没有头像 URL / 画不了），
 * 只有真要加载头像图片时才异步——等最多 `LOAD_TIMEOUT_MS`，加载失败、超时都退回占位。
 * `deliver` 恰好调一次；`undefined` = 不带头像（系统用应用图标）。
 */
export function withNotifyIcon(src: NotifyIconSource | null, deliver: (icon: string | undefined) => void): void {
  if (!src) { deliver(undefined); return; }
  const key = `${src.url ?? ""}|${src.seed}|${src.label}`;
  const hit = cache.get(key);
  if (hit) { deliver(hit); return; }
  // 只缓存「定论」：真画出来的头像、或本来就没有头像 URL 的占位。加载失败 / 超时退回的占位不缓存——
  // 那可能只是这一下网慢，缓存住就会让这个会话以后每条通知都停在占位上。
  const finish = (dataUrl: string | undefined): void => {
    const out = dataUrl ?? placeholder(src);
    if (out && (dataUrl || !src.url)) remember(key, out);
    deliver(out);
  };
  if (!src.url || typeof Image === "undefined" || !newCanvas()) { finish(undefined); return; }

  let done = false;
  const settle = (dataUrl: string | undefined): void => { if (!done) { done = true; finish(dataUrl); } };
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => settle(fromImage(img));
  img.onerror = () => settle(undefined);
  setTimeout(() => settle(undefined), LOAD_TIMEOUT_MS);
  img.src = src.url;
}

/** 只给测试用：清掉头像缓存。 */
export function resetNotifyIconCacheForTests(): void {
  cache.clear();
}
