// 通用虚拟列表：只渲染视口内可见的行（+ 上下缓冲），把长列表的 DOM 从 N 个降到几十个。
// 用于通讯录 2000 好友首屏（全量挂 DOM 时渲染 ≈530ms，见 IMServer/docs/LOAD_TESTING.md 场景⑥）。
//
// 设计要点：
//  - 复用**外部已有的滚动容器**（scrollElRef，如 .convlist），不自造滚动区——保持与列表上方
//    搜索结果/新的朋友/分组标签同处一个滚动，UX 不变（对齐现状）。
//  - **测量不进滚动帧**：scrollMargin（本列表在滚动内容中的偏移）只在「容器尺寸变化」或
//    「上方内容增删」时重算，靠 ResizeObserver + MutationObserver 触发，且**忽略本组件自身
//    换行造成的 DOM 变动**。绝不在每次 render 的 layout effect 里量——滚动时虚拟化器每帧重渲染，
//    那等于每帧插两次强制同步重排，反过来吃掉虚拟化的收益。
//  - **等高假设 + 持续观测**：所有行样式一致（.convitem ≈77px）。首次实测即采信，其后由
//    ResizeObserver 持续观测当前首行（Web 字体晚加载、缩放等会改变行高），**只增不减**地更新——
//    单调避免不同行细微高差导致来回抖动。刻意不用逐行 measureElement（等高列表上只会引发回弹）。
//  - **零高度兜底**：容器 clientHeight 为 0 时（布局过渡、后台标签页恢复、父级 flex 短暂塌陷）
//    虚拟化器算不出可见区、返回空窗口 → 整列表空白。此时退化为渲染前若干行，保证有内容可见
//    （旧的全量 map 实现不依赖容器高度，不能因引入虚拟化而新增这个失败模式）。
//  - **滚动父收进 state 再用**（scrollEl，别直接读 scrollElRef.current）：React 提交阶段
//    先跑子组件的 layout effect、再给祖先赋 ref，所以挂载那一帧 ref 还是 null。直接读它，
//    虚拟化器就订阅不到滚动容器、此后永远停在 offset 0——表现是**列表只渲染开头几行，
//    往下滚是空白**。passive effect 在整棵树 ref 都挂好之后才跑，那时取到元素、setState
//    逼一次重渲染，虚拟化器才会重新订阅。2026-09-01 在详情抽屉（成员列表）上实测到；
//    通讯录一直没暴露只是因为 App 重渲染频繁，顺手把它救了回来。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface VirtualListProps<T> {
  items: T[];
  /** 外部滚动容器的 ref（列表所在的可滚动祖先）。 */
  scrollElRef: RefObject<HTMLElement | null>;
  /** 稳定行 key：避免增删/重排时错位复用 DOM。 */
  getKey: (item: T, index: number) => string | number;
  renderRow: (item: T, index: number) => ReactNode;
  /** 首帧行高估算（px）；真实行高由首行实测覆盖。 */
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

  // ---- 滚动父：从 ref 收进 state（理由见文件头「滚动父收进 state 再用」）----
  // 无依赖数组=每次渲染后跑一遍，同值 setState 会被 React bail out，故不会自激；
  // 顺带覆盖「滚动容器被换掉」（切会话重挂 .detail-panel）的情形。
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setScrollEl(scrollElRef.current ?? null); });

  // ---- scrollMargin：本列表相对「滚动内容顶」的偏移（上方搜索框/入口/标签占的高度）----
  // 不用 offsetTop——它相对最近**定位**祖先（.convlist 为 static 时会偏到更上层，值错乱）；
  // 用 getBoundingClientRect 差 + 当前 scrollTop，与 CSS 定位无关，且滚动中恒定。
  const [scrollMargin, setScrollMargin] = useState(0);
  const measureMargin = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !scrollEl) return;
    const offset = wrap.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
    setScrollMargin((prev) => (Math.abs(prev - offset) < 0.5 ? prev : offset)); // 同值不触发重渲染
  }, [scrollEl]);

  useLayoutEffect(() => {
    measureMargin(); // 挂载 / 滚动父就位 / items 由空变非空后量一次
  }, [measureMargin, items.length === 0]);

  useEffect(() => {
    if (!scrollEl) return;
    const ro = new ResizeObserver(() => measureMargin()); // 容器尺寸变化（窗口 resize、侧栏折叠）
    ro.observe(scrollEl);
    const mo = new MutationObserver((records) => {
      const wrap = wrapRef.current;
      // 本组件自身换行（滚动时每帧发生）不算「上方内容变化」，跳过——否则又退回每帧测量。
      if (wrap && records.every((r) => wrap.contains(r.target))) return;
      measureMargin();
    });
    mo.observe(scrollEl, { childList: true, subtree: true }); // 上方搜索结果/新朋友区块增删
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [scrollEl, measureMargin]);

  // ---- 行高：首次实测采信，其后持续观测、只增不减 ----
  const [rowH, setRowH] = useState(estimateSize);
  const rowMeasured = useRef(false);
  const rowObserver = useRef<ResizeObserver | null>(null);
  const applyRowH = useCallback((h: number) => {
    if (!(h > 0)) return;
    setRowH((prev) => {
      if (!rowMeasured.current) {
        rowMeasured.current = true;
        return h; // 首次：直接采信实测（估算值可能比真实行高大或小）
      }
      return h > prev + 0.5 ? h : prev; // 其后单调增：吸收字体晚加载/缩放，且不会来回抖动
    });
  }, []);
  // 挂到当前渲染窗口的首行；行滚出后自动改挂新的首行（等高假设下量谁都一样）。
  const measureRow = useCallback(
    (el: HTMLDivElement | null) => {
      rowObserver.current?.disconnect();
      if (!el) return;
      applyRowH(el.getBoundingClientRect().height);
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          const box = e.borderBoxSize?.[0]?.blockSize; // 含 padding/border，与 rect.height 同口径
          applyRowH(box ?? (e.target as HTMLElement).getBoundingClientRect().height);
        }
      });
      ro.observe(el);
      rowObserver.current = ro;
    },
    [applyRowH],
  );
  useEffect(() => () => rowObserver.current?.disconnect(), []); // 卸载时收尾

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowH,
    overscan,
    scrollMargin,
    getItemKey: (index) => getKey(items[index], index),
  });

  const vItems = virtualizer.getVirtualItems();
  // 零高度兜底：容器测不出可见区时渲染前若干行，避免「数据已到却整列表空白」。
  const degraded = vItems.length === 0 && items.length > 0;
  const rows = degraded
    ? items.slice(0, Math.min(items.length, overscan * 2)).map((_, i) => ({
        key: getKey(items[i], i),
        index: i,
        offset: i * rowH, // 兜底路径自算偏移（相对包裹层顶，不含 scrollMargin）
      }))
    : vItems.map((vi) => ({ key: vi.key, index: vi.index, offset: vi.start - scrollMargin }));

  return (
    <div ref={wrapRef} style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
      {rows.map((row, i) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={i === 0 ? measureRow : undefined} // 只观测窗口首行
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${row.offset}px)`,
          }}
        >
          {renderRow(items[row.index], row.index)}
        </div>
      ))}
    </div>
  );
}
