// 「跳到某条消息」的 DOM 部分：找节点 → 滚到容器居中 → 高亮一闪；找不到时按模型判定给哪句提示。
//
// 从 App.jumpToSeq 原样搬出（CODING_STYLE §7 体量门禁）。它不碰 React 状态，只读 DOM 与传入的
// 渲染集，天然是纯函数——App 里那个 useCallback 只剩取 ref 与传回调。行为逐字不变。
import type { ChatMessage } from "./sdk/protocol";
import { resolveJumpTarget } from "./album";
import { minSeqOf } from "./messageContent";

export interface JumpDomDeps {
  /** 目标不在视口、即将滚离尾部时调：调用方据此清掉"贴底"状态（否则 onMediaLoad 会把人拽回去）。 */
  onLeaveTail(): void;
  setToast(text: string): void;
}

/** 在 `box` 里把 conv_seq=seq 的那一行滚到居中并高亮。`list` 是**当前渲染集**（判"跳不到"的方向用）。 */
export function jumpDomToSeq(box: HTMLElement, list: ChatMessage[], seq: number, deps: JumpDomDeps): void {
  const { onLeaveTail, setToast } = deps;
  let el = box.querySelector(`[data-seq="${seq}"]`);
  // 相册宫格成员：优先定位并高亮**那一格**（tile 带 data-album-seq），而非整条宫格主行。
  // 主行只有 leader 带 data-seq，非 leader 成员靠 tile 命中；找不到 tile 再回退到主行。目标决策见 resolveJumpTarget。
  const tgt = resolveJumpTarget(list, seq);
  if (tgt.kind === "album-tile") {
    const tile = box.querySelector(`[data-album-seq="${seq}"]`);
    if (tile) el = tile;
    else if (!el) el = box.querySelector(`[data-seq="${tgt.leaderSeq}"]`);
  }
  if (!el) {
    // 跳不到分两种，**按模型判定而非 DOM**（宫格从行/未来虚拟化都可能不渲染节点）：
    // 目标比已加载最早一条还早 → 还没上拉加载到；落在已加载窗口内却缺失 → 已被本地删除。
    // 窗口内无任何已确认消息（minSeq=0）判不出方向 → 回退通用提示。
    const earliest = minSeqOf(list);
    setToast(earliest === 0 ? "原消息不在当前视图"
      : seq < earliest ? "原消息较早，请上拉加载后重试" : "原消息已被删除");
    return;
  }
  const node = el;
  const flash = () => {
    node.classList.add("flash");
    window.setTimeout(() => node.classList.remove("flash"), 1200);
  };
  // 把目标行滚到容器纵向居中。只动 .msgs 自身 scrollTop（不用 scrollIntoView——会连带滚动 html/#root
  // 把 .app 顶出视口、间距塌陷）。**用瞬时赋值而非 `scrollTo({behavior:"smooth"})`**：本容器上方有大量
  // 异步布局的媒体（gated 缩略/视频），平滑滚动的动画目标被持续变化的 scrollHeight 打断，远距离目标**滚不动**
  // （实测 scrollTo smooth 到 5000px 外的目标 scrollTop 纹丝不动）；瞬时赋值可靠命中。
  const scrollToNode = () => {
    const r = node.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    box.scrollTop = box.scrollTop + (r.top - br.top) - (box.clientHeight - r.height) / 2;
  };
  const r0 = node.getBoundingClientRect();
  const br0 = box.getBoundingClientRect();
  if (r0.top >= br0.top && r0.bottom <= br0.bottom) { flash(); return; } // 已在视口内 → 直接闪
  // 跳走后不再「贴底」：否则从底部跳到较早的目标时，下方媒体（视频/图片）异步加载完成会触发
  // onMediaLoad 把 scrollTop 拽回 scrollHeight，定位当场被冲掉（远距离目标必现，近处目标因差值小看似正常）。
  onLeaveTail();
  scrollToNode();
  // 下一帧再校正一次：抵消滚动后上方媒体继续异步布局造成的目标位移，然后高亮。
  requestAnimationFrame(() => { scrollToNode(); flash(); });
}
