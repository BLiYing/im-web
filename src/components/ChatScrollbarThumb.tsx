import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { scrollbarThumb } from "../chatScrollbar";

const THUMB_INSET_PX = 2; // 滑块离容器右边缘的间距

/**
 * 消息列表右侧常驻可见的细滚动条滑块（六条用户报告第 6 项，2026-09-29）。
 *
 * 系统原生滚动条在 macOS「滚动时才显示」偏好下是覆盖式、一闪而过的（`.msgs` 的
 * `::-webkit-scrollbar` 样式只管颜色形状，管不了这条系统级淡入淡出策略——`offsetWidth ===
 * clientWidth` 已实测确认即使自定义了滚动条样式，Chrome 仍按 overlay 处理，不占布局空间、
 * 只在滚动瞬间闪现），用户报告"看不出能滚"。这里另起一个**常驻不受系统偏好影响**的滑块，
 * 对齐 Android `chatScrollbar`（Canvas 直绘、不依赖系统滚动条）的思路。
 *
 * 渲染成 `position: fixed`（配 `getBoundingClientRect()` 换算视口坐标），而不是挂在 `.msgs`
 * 内部用 `absolute`：`.msgs` 自己就是滚动容器，`absolute` 定位的子元素仍在它的滚动内容流里，
 * 会跟着消息一起被滚出视口——这是实测踩过的坑，不是过度设计。
 *
 * **`createPortal` 到 `document.body`，不能就地渲染在 `.msgs` 内部**：`.msgs` 自己带
 * `transform: translateZ(0)`（GPU 层提升，滚动性能用，不能去掉），而 CSS 规则是——祖先一旦
 * 有 `transform`，就成了 `position:fixed` 后代的containing block，`fixed` 会退化成相对**那个
 * 祖先**定位而不是视口，算出来的坐标全部偏移了 `.msgs` 自己的位置（实测复现：滑块套了两次
 * 偏移量，落到了视口外）。挂到 `body` 下彻底避开这条 containing-block 坑。
 *
 * 直接操作 DOM 而不进 React state：滚动事件每帧都可能触发，走 setState 会让整个消息列表
 * 跟着高频重渲染。
 */
export function ChatScrollbarThumb({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = targetRef.current;
    const thumb = thumbRef.current;
    if (!box || !thumb) return;

    const update = () => {
      const t = scrollbarThumb(box.scrollTop, box.scrollHeight, box.clientHeight);
      if (!t) {
        thumb.style.display = "none";
        return;
      }
      const rect = box.getBoundingClientRect();
      thumb.style.display = "block";
      thumb.style.left = `${rect.right - THUMB_INSET_PX - 4}px`;
      thumb.style.top = `${rect.top + t.top}px`;
      thumb.style.height = `${t.height}px`;
    };

    update();
    box.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    // 消息加载/窗口变化会改 scrollHeight，但不一定触发 scroll 事件（如顶部插入更早的历史）
    const ro = new ResizeObserver(update);
    ro.observe(box);
    const mo = new MutationObserver(update);
    mo.observe(box, { childList: true, subtree: true });

    return () => {
      box.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [targetRef]);

  return createPortal(
    <div ref={thumbRef} className="msgs-scrollbar-thumb" style={{ display: "none" }} />,
    document.body,
  );
}
