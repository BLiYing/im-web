// 「滚到底自动续拉」（PERF-members-autoload，2026-09-01）。
//
// 背景：成员列表一页 50 人，此前只能手点「加载更多成员」——2 万人群要点 **400 次**。
// 注意这与虚拟化不是一回事：虚拟化解决「已加载的行别撑爆 DOM」，
// 这里解决「怎么把它们加载进来」。
//
// 为什么用 scroll 监听而不是 IntersectionObserver：阈值（"离底还剩多少"）在这里是要表达的
// 业务量，直接写出来比换算 rootMargin 直观；且滚动容器是外部注入的（详情抽屉），
// 与 VirtualList 用的是同一个，多挂一个 passive 监听的成本可以忽略。
import { useEffect, useRef, type RefObject } from "react";

/** 离底多少像素就开始拉下一页。约 1~2 屏成员行（行高 ≈68px），滚到底前就已经拉好。 */
export const AUTO_LOAD_THRESHOLD_PX = 600;

export interface AutoLoadMoreOptions {
  /** 还有下一页、且当前没在拉。false = 不挂监听。 */
  enabled: boolean;
  /** 触发续拉。**调用方自己要有在途守卫**——滚动事件很密，本 hook 不去抖。 */
  onLoadMore: () => void;
  /**
   * 内容变化的信号（一般传 `list.length`）。变了就重新自查一次——
   * 新拉的一页若仍不够填满视口，不重查就再也不会触发（滚动事件不会自己发生）。
   */
  signal: unknown;
  thresholdPx?: number;
}

/**
 * 滚动容器接近底部时自动触发续拉。
 *
 * @param scrollElRef 外部滚动容器（与 VirtualList 用同一个）。为空 = 不生效（不报错）。
 */
export function useAutoLoadMore(
  scrollElRef: RefObject<HTMLElement | null>,
  { enabled, onLoadMore, signal, thresholdPx = AUTO_LOAD_THRESHOLD_PX }: AutoLoadMoreOptions,
): void {
  // 回调放 ref：调用方多半传内联箭头函数，进依赖数组会让监听每次渲染重挂。
  const cbRef = useRef(onLoadMore);
  cbRef.current = onLoadMore;

  useEffect(() => {
    const el = scrollElRef.current;
    if (!el || !enabled) return;
    const nearBottom = () => {
      // **零高度不触发**：布局过渡 / 后台标签页恢复 / 父级 flex 短暂塌陷时 clientHeight 为 0，
      // 此时 scrollHeight 也可能是 0 → 距底 0 → 会在用户根本没看见列表时把 400 页全拉下来。
      // （VirtualList 的「零高度兜底」是同一类问题的另一面。）
      if (el.clientHeight <= 0) return false;
      return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
    };
    const check = () => { if (nearBottom()) cbRef.current(); };
    check(); // 首帧自查：内容不满一屏时永远不会有 scroll 事件，光挂监听等于没做
    el.addEventListener("scroll", check, { passive: true });
    return () => el.removeEventListener("scroll", check);
  }, [scrollElRef, enabled, signal, thresholdPx]);
}
