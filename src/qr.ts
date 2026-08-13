// 二维码体系（QRCODE P0）纯逻辑：扫码结果 → UI 分支映射 + 图片/摄像头解码。
// 语义判定全在服务端 /qr/resolve；本模块只把 resolve 结果映射成按钮态，并封装本地二维码解码。
// 映射函数是纯的（可单测）；解码函数依赖浏览器 canvas，仅运行期用。
import jsQR from "jsqr";
import type { QRUserCard, QRGroupCard } from "./sdk/protocol";

/** 名片码扫后主按钮态（self=看自己资料、friend=发消息、stranger=加好友、blocked=不给加好友入口）。 */
export type UserAction = { kind: "self" | "message" | "add" | "blocked"; label: string };

export function userCardAction(c: QRUserCard): UserAction {
  switch (c.relation) {
    case "self":
      return { kind: "self", label: "查看我的资料" };
    case "friend":
      return { kind: "message", label: "发消息" };
    case "blocked":
      return { kind: "blocked", label: "查看资料" }; // 不因扫码开加好友后门
    default:
      return { kind: "add", label: "添加到通讯录" };
  }
}

/** 群码扫后主按钮态。enter=已在群进聊天、join=直接加入、apply=需审批申请、disabled=不可加入(带原因)。 */
export type GroupAction = { kind: "enter" | "join" | "apply" | "disabled"; label: string; note?: string };

export function groupCardAction(c: QRGroupCard): GroupAction {
  if (c.joined) return { kind: "enter", label: "进入群聊" };
  if (!c.joinable) {
    switch (c.reason) {
      case "full":
        return { kind: "disabled", label: "该群人数已满", note: "群成员已达上限，暂时无法加入" };
      case "banned":
        return { kind: "disabled", label: "无法加入", note: "你已被移出该群，暂时或永久不可加入" };
      default:
        return { kind: "disabled", label: "无法加入", note: "" };
    }
  }
  if (c.reason === "approval") return { kind: "apply", label: "申请加入", note: "该群需管理员审批" };
  return { kind: "join", label: "加入群聊" };
}

/** 外来码（unknown）：判定是不是 URL 并抽出域名主体，供二次确认高亮。纯文本 isUrl=false。 */
export function classifyUnknown(text: string): { isUrl: boolean; domain?: string } {
  const t = text.trim();
  if (!/^https?:\/\//i.test(t)) return { isUrl: false };
  try {
    return { isUrl: true, domain: new URL(t).hostname };
  } catch {
    return { isUrl: false };
  }
}

/** 从抛出的错误里取业务码（imSdk.api 已把 code 挂到 Error 上）；无则 0。 */
export function errorCode(e: unknown): number {
  if (e && typeof e === "object" && "code" in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === "number") return c;
  }
  return 0;
}

// ---- 本地解码（运行期，浏览器）----

/** 从一帧 ImageData 解码二维码文本；无码返回 null。摄像头循环与图片解码共用。 */
export function decodeImageData(img: ImageData): string | null {
  const res = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
  return res?.data ?? null;
}

/** 把一张图片文件解码为二维码文本（缩放到 ≤1024 边长再解，兼顾大截图与速度）；无码 null。 */
export async function decodeImageFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const imgEl = await loadImage(url);
    const img = drawToImageData(imgEl, 1024);
    return img ? decodeImageData(img) : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image load failed"));
    el.src = src;
  });
}

// 复用单块离屏 canvas：摄像头识别循环每帧都调 drawToImageData，逐帧新建 canvas 会churn GC。
// 单线程顺序使用（循环 + 一次性图片解码不会并发），共享安全。
let scratchCanvas: HTMLCanvasElement | null = null;

/** 把 <img>/<video> 画到离屏 canvas 并取 ImageData（限制最长边 maxEdge）。取不到 2D 上下文返回 null。 */
export function drawToImageData(
  el: HTMLImageElement | HTMLVideoElement,
  maxEdge: number,
): ImageData | null {
  const w0 = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const h0 = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!w0 || !h0) return null;
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  if (!scratchCanvas) scratchCanvas = document.createElement("canvas");
  const canvas = scratchCanvas;
  canvas.width = w;   // 赋值即清空画布
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(el, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
