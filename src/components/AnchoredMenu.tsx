import { useLayoutEffect, useRef, useState } from "react";

/** 可复用的锚定弹出菜单：以 (x,y) 为锚点，若超出视口右/下边界则自动向左/上翻转（右键消息/会话菜单共用）。 */
export function AnchoredMenu({ x, y, className, children }: { x: number; y: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    let left = x, top = y;
    if (left + r.width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - r.width - margin);
    if (top + r.height > window.innerHeight - margin) top = Math.max(margin, y - r.height); // 下方放不下 → 上翻
    setPos({ left, top });
  }, [x, y]);
  return (
    <div ref={ref} className={className} style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
