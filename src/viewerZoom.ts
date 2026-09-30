// 媒体查看器图片缩放/平移的几何（纯逻辑，见 viewerZoom.test.ts）。组件侧见 components/ZoomableImage。
//
// 坐标约定：图片以 `transform: translate(x, y) scale(k)` 呈现，变换原点是图片中心。
// 所有「点」都相对**图片静止时的中心**（未缩放未平移时图片中心在屏幕上的位置），单位 CSS px。
// 于是图上一点 p（相对图片中心的本地偏移）落在屏幕上的位置是 `t + k·p`。

export interface Size { w: number; h: number }
export interface Point { x: number; y: number }
export interface ZoomState { scale: number; x: number; y: number }

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 5;
/** 双击在 1× 与这个倍数之间切换。 */
export const ZOOM_DOUBLE = 2;
/** 键盘 +/- 每按一下的倍率。 */
export const ZOOM_KEY_STEP = 1.5;
export const ZOOM_IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

/** 钳到 [1×, 5×]；**缩小**到贴近 1× 时吸附回 1×（滚轮缩回去总差一点点，停在 1.01× 会留着"可拖"的手型却拖不动）。
 *  from 是缩放前的倍率：只在 k ≤ from（往回缩）时吸附。放大方向不能吸——高精度触控板 / 捏合起手的
 *  每个事件只有 1.00x 倍，逐次被吸回 1× 就永远放大不起来（累计不上去）。 */
export function clampScale(k: number, from: number = Infinity): number {
  if (!Number.isFinite(k) || k <= ZOOM_MIN) return ZOOM_MIN;
  if (k < ZOOM_MIN + 0.02 && k <= from) return ZOOM_MIN;
  return Math.min(k, ZOOM_MAX);
}

/** 平移钳制：放大后的图在某一轴上比视口大，才允许在这一轴上拖，且最多拖到图的边贴住视口的边；
 *  不比视口大的那一轴锁在正中——图不会被拖出屏幕，也不会在四周露出比必要更多的黑边。 */
export function clampPan(s: ZoomState, base: Size, viewport: Size): ZoomState {
  const maxX = Math.max(0, (base.w * s.scale - viewport.w) / 2);
  const maxY = Math.max(0, (base.h * s.scale - viewport.h) / 2);
  // `|| 0`：抹掉 -0（toEqual 会区分 0 与 -0，transform 里写出来也是 "-0px"）。
  return { scale: s.scale, x: Math.min(Math.max(s.x, -maxX), maxX) || 0, y: Math.min(Math.max(s.y, -maxY), maxY) || 0 };
}

/** 以 anchor（通常是鼠标位置）为不动点缩放到 target 倍：缩放前后，anchor 底下是图上的同一个点。
 *  之后再过一遍 clampPan——贴边时不动点会让位给「不露多余黑边」。 */
export function zoomAt(s: ZoomState, target: number, anchor: Point, base: Size, viewport: Size): ZoomState {
  const k = clampScale(target, s.scale);
  if (k === ZOOM_MIN) return ZOOM_IDENTITY;
  const px = (anchor.x - s.x) / s.scale;
  const py = (anchor.y - s.y) / s.scale;
  return clampPan({ scale: k, x: anchor.x - k * px, y: anchor.y - k * py }, base, viewport);
}

/** 一次 wheel 事件对应的倍率。向上滚（deltaY<0）放大。
 *  pinch=true 是触控板捏合（浏览器合成成 ctrlKey+wheel，delta 很小），灵敏度要高得多；
 *  deltaMode=1（Firefox 的按行滚）先折算成像素。单次事件封顶，免得惯性滚动一下冲到头。 */
export function wheelFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const exp = -px * (pinch ? 0.01 : 0.002);
  return Math.exp(Math.min(Math.max(exp, -0.5), 0.5));
}
