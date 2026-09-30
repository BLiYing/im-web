import { useEffect, useRef, type RefObject } from "react";
import { scrollbarThumb } from "../chatScrollbar";

const THUMB_INSET_PX = 2; // 滑块离容器右边缘的间距
const THUMB_WIDTH_PX = 4;

/**
 * 消息列表右侧常驻可见的细滚动条滑块（六条用户报告第 6 项，2026-09-29）。
 *
 * 系统原生滚动条在 macOS「滚动时才显示」偏好下是覆盖式、一闪而过的（`.msgs` 的
 * `::-webkit-scrollbar` 样式只管颜色形状，管不了这条系统级淡入淡出策略——`offsetWidth ===
 * clientWidth` 已实测确认即使自定义了滚动条样式，Chrome 仍按 overlay 处理，不占布局空间、
 * 只在滚动瞬间闪现），用户报告"看不出能滚"。这里另起一个**常驻不受系统偏好影响**的滑块，
 * 对齐 Android `chatScrollbar`（Canvas 直绘、不依赖系统滚动条）的思路。
 *
 * **必须渲染成 `.msgs` 的兄弟节点（放在 `.chat` 里、`position: absolute`），不能放 `.msgs` 内部，
 * 也不能 portal 到 `document.body` 用 `fixed`**：
 * - 放 `.msgs` 内部：`.msgs` 自己就是滚动容器，`absolute` 子元素跟着消息一起被滚出视口。
 * - portal 到 body + `fixed` + `getBoundingClientRect()`（2026-09-29 首版）踩了两个坑：
 *   ① 开/关资料页时 `.main` 走 `transform: translateX` 动画平移，`.msgs` 尺寸不变、也不滚动，
 *      ResizeObserver/scroll 都不触发，滑块停在旧的视口坐标，要等下次滚动才跟上；
 *   ② 挂在 `.app`（`isolation: isolate` 独立层叠上下文）之外、DOM 顺序又在后面，整层画在
 *      `.app` 之上——通话界面（CallOverlay，z-index 9000 但困在 `.app` 里）、弹窗都盖不住它。
 * 作为 `.chat` 的子元素，坐标取 `.msgs` 相对 `.chat` 的 offsetTop/offsetLeft（布局坐标，不含 transform），
 * 平移动画天然随父级走；层叠也回到 `.main` 之内，任何覆盖层都能正常盖住。
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
      thumb.style.display = "block";
      thumb.style.left = `${box.offsetLeft + box.offsetWidth - THUMB_INSET_PX - THUMB_WIDTH_PX}px`;
      thumb.style.top = `${box.offsetTop + t.top}px`;
      thumb.style.height = `${t.height}px`;
    };

    update();
    box.addEventListener("scroll", update, { passive: true });
    // 消息加载/横幅出现收起会改 scrollHeight 或 .msgs 尺寸，但不一定触发 scroll 事件（如顶部插入更早的历史）
    const ro = new ResizeObserver(update);
    ro.observe(box);
    const mo = new MutationObserver(update);
    mo.observe(box, { childList: true, subtree: true });

    return () => {
      box.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [targetRef]);

  return <div ref={thumbRef} className="msgs-scrollbar-thumb" style={{ display: "none" }} />;
}
