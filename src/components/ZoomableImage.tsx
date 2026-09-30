import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  ZOOM_DOUBLE, ZOOM_IDENTITY, ZOOM_KEY_STEP, clampPan, wheelFactor, zoomAt,
  type Point, type ZoomState,
} from "../viewerZoom";

// Safari 的触控板捏合不走 ctrl+wheel，而是私有的 gesture* 事件（带 scale = 相对手势起点的倍率）。
type GestureEvent = Event & { scale: number; clientX: number; clientY: number };

/** 媒体查看器里的大图：滚轮 / 触控板捏合缩放（以鼠标位置为中心）、双击 1×↔2×、放大后拖拽平移、
 *  键盘 `+` `-` `0`。几何全在 viewerZoom.ts，这里只接事件、套 transform。
 *
 *  **复位靠重挂**：调用方给它 `key={mediaKey}`，翻页 / 换图即新实例，不需要显式清状态。
 *  滚轮监听挂在所在的 `.viewer-mask` 上而不是图上——图外的黑边也能滚，缩小时鼠标不必停在图上。 */
export function ZoomableImage({ src, alt, onTap, onError }: {
  src: string;
  alt: string;
  /** 单击（不含拖拽松手、不含双击的缩放动作本身）。 */
  onTap: () => void;
  onError: () => void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState<ZoomState>(ZOOM_IDENTITY);
  const [animated, setAnimated] = useState(false); // 双击 / 键盘带过渡；滚轮、拖拽跟手，不带
  const [dragging, setDragging] = useState(false);
  // 最新值镜像：一帧里可能连来几个 wheel 事件，各自都得在前一个的结果上累计，读 state 会读到旧的。
  const zoomRef = useRef(zoom);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const dragMoved = useRef(false); // 这次按下是否拖动过：拖完松手的那一下 click 不算单击

  const apply = useCallback((next: ZoomState, withAnim: boolean) => {
    zoomRef.current = next;
    setZoom(next);
    setAnimated(withAnim);
  }, []);

  // 图片静止尺寸、视口、静止中心。**都取布局值**（offset*），不读 getBoundingClientRect——
  // 后者含 transform，过渡动画进行到一半时读出来的是中间态，锚点会算偏。
  const geometry = useCallback(() => {
    const el = ref.current;
    if (!el) return null;
    const parent = el.offsetParent?.getBoundingClientRect();
    return {
      base: { w: el.offsetWidth, h: el.offsetHeight },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      center: { x: (parent?.left ?? 0) + el.offsetLeft + el.offsetWidth / 2, y: (parent?.top ?? 0) + el.offsetTop + el.offsetHeight / 2 },
    };
  }, []);

  /** 缩放到 target 倍；at 为屏幕坐标（缺省 = 图片静止中心）。 */
  const zoomTo = useCallback((target: number, at: Point | null, withAnim: boolean) => {
    const g = geometry();
    if (!g) return;
    const anchor = at ? { x: at.x - g.center.x, y: at.y - g.center.y } : { x: 0, y: 0 };
    apply(zoomAt(zoomRef.current, target, anchor, g.base, g.viewport), withAnim);
  }, [apply, geometry]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const host: HTMLElement = el.closest<HTMLElement>(".viewer-mask") ?? el;
    // 必须是 non-passive：要 preventDefault 拦住 ctrl+wheel 触发的整页缩放（React 的 onWheel 是 passive 的）。
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomTo(zoomRef.current.scale * wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), { x: e.clientX, y: e.clientY }, false);
    };
    let gestureStart = 1;
    const onGestureStart = (e: Event) => { e.preventDefault(); gestureStart = zoomRef.current.scale; };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEvent;
      zoomTo(gestureStart * g.scale, { x: g.clientX, y: g.clientY }, false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return; // Cmd/Ctrl +/-/0 是浏览器自己的页面缩放，不抢
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === "+" || e.key === "=") zoomTo(zoomRef.current.scale * ZOOM_KEY_STEP, null, true);
      else if (e.key === "-" || e.key === "_") zoomTo(zoomRef.current.scale / ZOOM_KEY_STEP, null, true);
      else if (e.key === "0") apply(ZOOM_IDENTITY, true);
      else return;
      e.preventDefault();
    };
    // 窗口变了尺寸：图片静止尺寸与可拖范围都变了，直接回 1×，不去猜新的平移量。
    const onResize = () => apply(ZOOM_IDENTITY, false);
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("gesturestart", onGestureStart);
    host.addEventListener("gesturechange", onGestureChange);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("gesturestart", onGestureStart);
      host.removeEventListener("gesturechange", onGestureChange);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [apply, zoomTo]);

  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    dragMoved.current = false;
    if (e.button !== 0 || zoomRef.current.scale === 1) return; // 1× 没得拖
    // 指针捕获：拖出图片/窗口也继续收到 move/up，且松手的 click 仍落在图上（不会冒成「点遮罩关闭」）。
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: zoomRef.current.x, oy: zoomRef.current.y };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLImageElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved.current = true; // 手抖的一两个像素不算拖
    const g = geometry();
    if (!g) return;
    apply(clampPan({ scale: zoomRef.current.scale, x: d.ox + dx, y: d.oy + dy }, g.base, g.viewport), false);
  };
  const endDrag = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };
  const onClick = (e: ReactMouseEvent) => {
    e.stopPropagation(); // 点图不关查看器（只有点遮罩才关）
    if (dragMoved.current) { dragMoved.current = false; return; }
    onTap();
  };
  const onDoubleClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    zoomTo(zoomRef.current.scale > 1 ? 1 : ZOOM_DOUBLE, { x: e.clientX, y: e.clientY }, true);
  };

  const zoomed = zoom.scale > 1;
  return (
    <img ref={ref} src={src} alt={alt} draggable={false}
         className={`image-viewer zoomable${zoomed ? " zoomed" : ""}${dragging ? " dragging" : ""}${animated ? " zoom-anim" : ""}`}
         style={zoomed ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` } : undefined}
         onClick={onClick} onDoubleClick={onDoubleClick}
         onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
         onError={onError} />
  );
}
