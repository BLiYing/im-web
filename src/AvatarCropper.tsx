import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import { AVATAR_OUT, avatarBaseScale, clampTranslate, cropSourceRect } from "./avatarCrop";

// 圆形头像裁切弹窗（方案 C · Web 端）。规格见 docs/UX_SKETCH.html §Web：
// 圆窗 ⌀180px、画布 328×236、遮罩 rgba(0,0,0,0.5)、缩放 1×–3×（滑杆 + 滚轮 + 捏合），
// 输出圆的外接正方形 → 256×256 JPEG(q0.85)。存方图、显示时切圆（与 iOS 一致，走 JPEG 可去重）。
// 坐标/尺寸换算抽到纯模块 avatarCrop.ts（可单测）。
const CIRCLE = 180; // 圆形取景框直径
const CANVAS_W = 328; // 画布宽（卡片内宽）
const CANVAS_H = 236; // 画布高
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

interface Props {
  file: File;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

// AvatarCropper 只负责「取一张图 → 裁出圆区 → 回一个 256×256 JPEG blob」，不涉及上传与业务。
export default function AvatarCropper({ file, onConfirm, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // 变换态放 ref（拖动/绘制高频，不进 React 渲染）；zoom 另存 state 以驱动滑杆受控显示。
  const st = useRef({ tx: 0, ty: 0, baseScale: 1, zoom: 1 });
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [saveErr, setSaveErr] = useState(""); // 生成/裁切失败的可重试提示

  // 载入图片：算出「短边充满圆」的基准缩放，作为 zoom=1。
  // 注意：StrictMode 下 effect 会「装载→卸载→再装载」双跑。objectURL 绝不能在 cleanup 里吊销——
  // 那会在图片异步解码前就失效，触发 onerror 误报「格式不对」。改为在 load/error 回调里吊销，
  // 并用 cancelled 守卫忽略已卸载那一轮的回调。
  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (cancelled) return;
      imgRef.current = img;
      st.current = { tx: 0, ty: 0, baseScale: avatarBaseScale(img.width, img.height, CIRCLE), zoom: 1 };
      setReady(true);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (cancelled) return;
      setErr("无法识别该图片格式，请改用 JPG / PNG");
    };
    img.src = url;
    return () => { cancelled = true; };
  }, [file]);

  // 约束平移：图片必须始终盖住整个圆。
  const clamp = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const disp = st.current.baseScale * st.current.zoom;
    const c = clampTranslate(st.current.tx, st.current.ty, img.width, img.height, disp, CIRCLE);
    st.current.tx = c.tx;
    st.current.ty = c.ty;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const disp = st.current.baseScale * st.current.zoom;
    const cx = CANVAS_W / 2;
    const cy = CANVAS_H / 2;
    const w = img.width * disp;
    const h = img.height * disp;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.drawImage(img, cx + st.current.tx - w / 2, cy + st.current.ty - h / 2, w, h);
    // 圆外压暗：填充整块半透明黑，用 evenodd 挖掉圆。
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, CANVAS_W, CANVAS_H);
    ctx.arc(cx, cy, CIRCLE / 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fill("evenodd");
    ctx.restore();
    // 圆边（2px 白）。
    ctx.beginPath();
    ctx.arc(cx, cy, CIRCLE / 2, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }, []);

  useLayoutEffect(() => {
    if (ready) draw();
  }, [ready, draw]);

  // 滑杆改 zoom → 同步 ref + 夹紧 + 重绘。
  useEffect(() => {
    st.current.zoom = zoom;
    clamp();
    draw();
  }, [zoom, clamp, draw]);

  // 指针：单指拖动平移，双指捏合缩放。
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragLast = useRef<{ x: number; y: number } | null>(null);
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);

  const onPointerDown = (e: RPointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      dragLast.current = { x: e.clientX, y: e.clientY };
    } else if (pointers.current.size === 2) {
      const p = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), zoom: st.current.zoom };
      dragLast.current = null;
    }
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchStart.current && pointers.current.size === 2) {
      const p = [...pointers.current.values()];
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStart.current.zoom * (d / pinchStart.current.dist))));
    } else if (dragLast.current) {
      st.current.tx += e.clientX - dragLast.current.x;
      st.current.ty += e.clientY - dragLast.current.y;
      dragLast.current = { x: e.clientX, y: e.clientY };
      clamp();
      draw();
    }
  };
  const onPointerUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) dragLast.current = null;
  };

  // 滚轮缩放：React 合成 wheel 默认 passive，preventDefault 无效 → 用原生非 passive 监听，
  // 才能阻止缩放头像时背后页面一起滚。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.002)));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [ready]);

  // 确定：把圆的外接正方形从源图裁出 → 256×256 JPEG。
  const confirm = () => {
    const img = imgRef.current;
    if (!img) return;
    const disp = st.current.baseScale * st.current.zoom;
    const { sx, sy, size } = cropSourceRect(img.width, img.height, disp, st.current.tx, st.current.ty, CIRCLE);
    const out = document.createElement("canvas");
    out.width = AVATAR_OUT;
    out.height = AVATAR_OUT;
    const octx = out.getContext("2d");
    if (!octx) {
      setSaveErr("生成图片失败，请重试");
      return;
    }
    octx.drawImage(img, sx, sy, size, size, 0, 0, AVATAR_OUT, AVATAR_OUT);
    out.toBlob(
      (b) => {
        if (b) {
          onConfirm(b);
        } else {
          setSaveErr("生成图片失败，请重试"); // toBlob 偶发返回 null：给反馈并保持弹窗可重试
        }
      },
      "image/jpeg",
      0.85,
    );
  };

  return (
    <div className="modal-mask avatar-cropper-mask">
      <div className="avatar-cropper">
        <div className="ac-head">
          <span>裁剪头像</span>
          <button className="ac-x" onClick={onCancel} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="ac-canvas-wrap">
          {err ? (
            <div className="ac-err">{err}</div>
          ) : (
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              className="ac-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          )}
        </div>
        <div className="ac-zoom">
          <span className="ac-zi" aria-hidden>
            －
          </span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="ac-slider"
            disabled={!!err}
            aria-label="缩放"
          />
          <span className="ac-zi" aria-hidden>
            ＋
          </span>
        </div>
        <div className="ac-foot">
          {saveErr && <span className="ac-save-err">{saveErr}</span>}
          <button className="ac-btn ghost" onClick={onCancel}>
            取消
          </button>
          <button className="ac-btn pri" onClick={() => { setSaveErr(""); confirm(); }} disabled={!ready || !!err}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
