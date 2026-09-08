// 窗口位置与大小的记忆。存在 userData/device.json（与 deviceId / localPort 同一份本机状态）。
//
// 为什么值得做：桌面端用户会把窗口摆到固定位置、拉成固定宽度，每次启动都跳回默认尺寸
// 是那种「说不上是 bug 但一直烦人」的事。移动端没有这个概念，所以它在 CLIENT_PARITY 里
// 只属于 Desktop 那一列。
//
// **多显示器的坑**：显示器拔掉后，上次记下的坐标可能落在任何屏幕之外，窗口会开在看不见的地方，
// 用户以为应用没启动。所以恢复前必须拿当前所有显示器的工作区校验一次。
import { readLocalState, writeLocalState } from "./identity";

/** 一块屏幕的可用区域。抽成参数而不是直接读 `screen`，是为了让判断逻辑能单测——
 *  这段逻辑判错的后果是「窗口开在看不见的地方，用户以为应用没启动」，不该只靠肉眼验。 */
export interface WorkArea { x: number; y: number; width: number; height: number }

export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface WindowState { bounds?: WindowBounds; maximized?: boolean }

const DEFAULT_SIZE = { width: 1180, height: 800 };
export const MIN_SIZE = { width: 720, height: 560 };   // 再窄下去 im-web 的双栏会挤成一坨

function isNum(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }

/** 这块矩形是不是还有**足够一部分**落在某块屏幕里。整块在屏外 = 用户看不见 = 等于没启动。 */
export function isVisibleOnSomeDisplay(b: WindowBounds, areas: WorkArea[]): boolean {
  // 只要有 80×80 的一角可见就算数——够用户抓住标题栏拖回来。
  const MIN_VISIBLE = 80;
  return areas.some((w) => {
    const overlapX = Math.min(b.x + b.width, w.x + w.width) - Math.max(b.x, w.x);
    const overlapY = Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y);
    return overlapX >= MIN_VISIBLE && overlapY >= MIN_VISIBLE;
  });
}

export interface RestoredWindow { width: number; height: number; x?: number; y?: number; maximized: boolean }

/** 纯判断：给定存下来的状态与当前屏幕布局，算出该用什么几何。**没有 electron 依赖，可单测。** */
export function decideWindowGeometry(raw: WindowState | undefined, areas: WorkArea[]): RestoredWindow {
  const b = raw?.bounds;
  const sizeOk = !!b && isNum(b.width) && isNum(b.height)
    && b.width >= MIN_SIZE.width && b.height >= MIN_SIZE.height;
  if (!sizeOk) return { ...DEFAULT_SIZE, maximized: !!raw?.maximized };

  const posOk = isNum(b.x) && isNum(b.y) && isVisibleOnSomeDisplay(b, areas);
  return posOk
    ? { width: b.width, height: b.height, x: b.x, y: b.y, maximized: !!raw?.maximized }
    // 尺寸可信但位置不可信（显示器拔了 / 分辨率变了）：留住尺寸，位置交给系统居中。
    : { width: b.width, height: b.height, maximized: !!raw?.maximized };
}

/** 读回上次的窗口状态；**任何一项不可信就整体回退默认**，宁可开在中间也不要开在看不见的地方。 */
export function restoreWindowState(): RestoredWindow {
  // 只有这一层碰 electron，判断本身在 decideWindowGeometry 里。
  const { screen } = require("electron") as typeof import("electron");
  return decideWindowGeometry(
    readLocalState().windowState as WindowState | undefined,
    screen.getAllDisplays().map((d) => d.workArea),
  );
}

/** 存当前状态。**最大化时不要存 bounds**——那会把全屏尺寸当成用户的常用尺寸，
 *  下次取消最大化就还原不回原来那个窗口了。 */
export function saveWindowState(win: { getNormalBounds(): WindowBounds; isMaximized(): boolean; isDestroyed(): boolean }): void {
  if (win.isDestroyed()) return;
  // getNormalBounds() 给的是「非最大化时的」几何，正是我们要记的那一份。
  writeLocalState({ windowState: { bounds: win.getNormalBounds(), maximized: win.isMaximized() } });
}
