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

/** 一枚扫码原文的本地粗判类型（不查库，仅供多码选择列表打标签；语义仍由服务端 resolve 定夺）。 */
export type RawKind = "user" | "group" | "login" | "url" | "text";

/** 本地判定扫码原文属于哪种码 + 给个人类可读标签（多枚候选选择列表用）。与后端 parseRaw 同规则识别 q/[ugl]。 */
export function describeRaw(raw: string): { kind: RawKind; label: string } {
  const s = (raw || "").trim();
  const m = /\/q\/([ugl])\//.exec(s.startsWith("q/") ? "/" + s : s);
  if (m) {
    if (m[1] === "u") return { kind: "user", label: "名片码" };
    if (m[1] === "g") return { kind: "group", label: "群二维码" };
    return { kind: "login", label: "登录二维码" };
  }
  const u = classifyUnknown(s);
  if (u.isUrl) return { kind: "url", label: u.domain || "网页链接" };
  return { kind: "text", label: s.length > 24 ? s.slice(0, 24) + "…" : s || "（空）" };
}

// ---- 本地解码（运行期，浏览器）----

/** 从一帧 ImageData 解码二维码文本；无码返回 null。摄像头循环用（单帧只取一枚，省 mask 重扫开销）。 */
export function decodeImageData(img: ImageData): string | null {
  const res = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
  return res?.data ?? null;
}

type Pt = { x: number; y: number };

/** 把一枚已解出的码所在矩形涂白，避免下一轮 jsQR 又解到同一枚。外扩一圈以盖住 finder pattern 边缘。 */
function maskRegion(data: Uint8ClampedArray, w: number, h: number, loc: Record<string, Pt | undefined>): void {
  const pts = Object.values(loc).filter((p): p is Pt => !!p);
  if (!pts.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const pad = Math.max(8, (x1 - x0 + y1 - y0) * 0.04);
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(w - 1, Math.ceil(x1 + pad)); y1 = Math.min(h - 1, Math.ceil(y1 + pad));
  for (let y = y0; y <= y1; y++) {
    let idx = (y * w + x0) * 4;
    for (let x = x0; x <= x1; x++, idx += 4) {
      data[idx] = 255; data[idx + 1] = 255; data[idx + 2] = 255; data[idx + 3] = 255;
    }
  }
}

// jsQR 一次只定位一枚码，且一张图有多个码时 finder pattern 会互相干扰、常常直接定位失败。
// 真正可靠的「一图多码」解码要靠浏览器原生 BarcodeDetector（Chrome/Edge 桌面支持）。
// 策略：优先 BarcodeDetector 取全部；不支持/失败时退回 jsQR（单码可靠，多码尽力）。
type DetectedBarcode = { rawValue: string };
interface BarcodeDetectorLike { detect(src: ImageData): Promise<DetectedBarcode[]>; }
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

async function makeBarcodeDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    if (Ctor.getSupportedFormats) {
      const fmts = await Ctor.getSupportedFormats();
      if (!fmts.includes("qr_code")) return null;
    }
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

/** jsQR 兜底：mask-and-repeat 尽力多解，主要保证单码可靠（多码定位常失败，属库的固有局限）。 */
function decodeAllViaJsQR(img: ImageData, max: number, seen: Set<string>): string[] {
  const data = new Uint8ClampedArray(img.data); // 复制：mask 会改像素，不能污染调用方的帧（摄像头共用 scratch）
  const out: string[] = [...seen];
  for (let i = 0; i < max && out.length < max; i++) {
    const res = jsQR(data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    if (!res) break;
    if (res.data && !seen.has(res.data)) { seen.add(res.data); out.push(res.data); }
    maskRegion(data, img.width, img.height, res.location); // 无论是否新码都 mask 推进，否则死循环靠 max 兜底
  }
  return out.slice(0, max);
}

/** 解出一帧 ImageData 里的所有二维码文本（去重、最多 max 枚）。单枚/无码也走这里。 */
export async function decodeAllImageData(img: ImageData, max = 8): Promise<string[]> {
  const seen = new Set<string>();
  const det = await makeBarcodeDetector();
  if (det) {
    try {
      for (const b of await det.detect(img)) {
        if (b.rawValue && !seen.has(b.rawValue)) seen.add(b.rawValue);
        if (seen.size >= max) break;
      }
      if (seen.size) return [...seen].slice(0, max);
      // detect 成功但空（个别实现对小图漏检）→ 落 jsQR 再试
    } catch {
      /* BarcodeDetector 抛错 → 落 jsQR */
    }
  }
  return decodeAllViaJsQR(img, max, seen);
}

/** 把一张图片文件解码为其中所有二维码文本（缩放到 ≤1024 边长再解）；无码返回空数组。 */
export async function decodeAllImageFile(file: File, max = 8): Promise<string[]> {
  const url = URL.createObjectURL(file);
  try {
    const imgEl = await loadImage(url);
    const img = drawToImageData(imgEl, 1024);
    return img ? await decodeAllImageData(img, max) : [];
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
