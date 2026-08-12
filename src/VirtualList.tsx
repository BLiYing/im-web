// 通用虚拟列表：只渲染视口内可见的行（+ 上下缓冲），把长列表的 DOM 从 N 个降到几十个。
// 用于通讯录 2000 好友首屏（全量挂 DOM 时渲染 ≈530ms，见 IMServer/docs/LOAD_TESTING.md 场景⑥）。
//
// 设计要点：
//  - 复用**外部已有的滚动容器**（scrollElRef，如 .convlist），不自造滚动区——保持与列表上方
//    搜索结果/新的朋友/分组标签同处一个滚动，UX 不变（对齐现状）。
//  - 因列表不从滚动顶部开始（上方有搜索框/标签），用 scrollMargin=本包裹层 offsetTop 校正坐标。
//  - **等高假设**：所有行样式一致（如 .convitem 固定 77px），故只测**首行一次**得真实行高，
//    全列表沿用该固定高。刻意不用逐行 measureElement——动态测高会在滚动中不断改变总高、
//    引发滚动位置回弹抖动（等高列表上纯属副作用）。
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface VirtualListProps<T> {
  items: T[];
  /** 外部滚动容器的 ref（列表所在的可滚动祖先）。 */
  scrollElRef: RefObject<HTMLElement | null>;
  /** 稳定行 key：避免增删/重排时错位复用 DOM。 */
  getKey: (item: T, index: number) => string | number;
  renderRow: (item: T, index: number) => ReactNode;
  /** 首帧行高估算（px）；真实行高由首行测量一次后覆盖。 */
  estimateSize?: number;
  /** 视口上下额外渲染的行数缓冲。 */
  overscan?: number;
}

export function VirtualList<T>({
  items,
  scrollElRef,
  getKey,
  renderRow,
  estimateSize = 64,
  overscan = 8,
}: VirtualListProps<T>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // 包裹层在滚动内容中的偏移（上方搜索框/标签占的高度）；随布局变化更新。
  // 不用 offsetTop——它相对的是最近**定位**祖先（.convlist 为 static 时会偏到更上层，值错乱）。
  // 用 getBoundingClientRect 差 + 当前 scrollTop 得「相对滚动内容顶」的真实偏移，与定位无关、且不随滚动变化。
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const scrollEl = scrollElRef.current;
    if (!wrap || !scrollEl) return;
    const offset = wrap.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
    setScrollMargin((prev) => (Math.abs(prev - offset) < 0.5 ? prev : offset)); // 稳定后同值不触发重渲染
  });

  // 等高测量：首行渲染后量一次真实高度，全列表沿用（避免逐行动态测高的滚动抖动）。
  const [rowH, setRowH] = useState(estimateSize);
  const measured = useRef(false);
  const measureFirstRow = useCallback((el: HTMLDivElement | null) => {
    if (el && !measured.current) {
      const h = el.getBoundingClientRect().height;
      if (h > 0) {
        measured.current = true;
        setRowH((prev) => (Math.abs(prev - h) < 0.5 ? prev : h));
      }
    }
  }, []);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElRef.current,
    estimateSize: () => rowH,
    overscan,
    scrollMargin,
    getItemKey: (index) => getKey(items[index], index),
  });
  const vItems = virtualizer.getVirtualItems();

  return (
    <div ref={wrapRef} style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
      {vItems.map((vi, i) => (
        <div
          key={vi.key}
          data-index={vi.index}
          ref={i === 0 ? measureFirstRow : undefined} // 只量窗口首行一次
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${vi.start - scrollMargin}px)`,
          }}
        >
          {renderRow(items[vi.index], vi.index)}
        </div>
      ))}
    </div>
  );
}
