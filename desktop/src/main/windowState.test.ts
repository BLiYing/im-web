// 窗口几何判断的护栏。**这段判错的后果是「窗口开在看不见的地方，用户以为应用没启动」**——
// 那种故障没有报错、没有日志，只有一个不肯出现的窗口，所以它值得被钉住。
import { describe, expect, it } from "vitest";
import { decideWindowGeometry, isVisibleOnSomeDisplay, MIN_SIZE, type WorkArea } from "./windowState";

/** 一块常见的 1440×900 主屏（顶部留出菜单栏）。 */
const MAIN: WorkArea = { x: 0, y: 25, width: 1440, height: 875 };
/** 右侧外接屏：坐标从 1440 起。拔掉它之后，记在这上面的窗口位置就全是屏外坐标。 */
const SECOND: WorkArea = { x: 1440, y: 0, width: 1920, height: 1080 };

describe("isVisibleOnSomeDisplay", () => {
  it("完全在主屏内 → 可见", () => {
    expect(isVisibleOnSomeDisplay({ x: 100, y: 100, width: 800, height: 600 }, [MAIN])).toBe(true);
  });

  it("只露出右下一角（≥80×80）→ 仍算可见，够用户拖回来", () => {
    expect(isVisibleOnSomeDisplay({ x: 1340, y: 800, width: 800, height: 600 }, [MAIN])).toBe(true);
  });

  it("只露出 20px → 不算可见（抓不住标题栏）", () => {
    expect(isVisibleOnSomeDisplay({ x: 1420, y: 400, width: 800, height: 600 }, [MAIN])).toBe(false);
  });

  it("**外接屏被拔掉** → 记在副屏上的窗口不再可见", () => {
    const onSecond = { x: 1600, y: 200, width: 900, height: 700 };
    expect(isVisibleOnSomeDisplay(onSecond, [MAIN, SECOND])).toBe(true);
    expect(isVisibleOnSomeDisplay(onSecond, [MAIN])).toBe(false);   // 拔掉之后
  });

  it("完全在屏幕上方（负 y，常见于分辨率变小）→ 不可见", () => {
    expect(isVisibleOnSomeDisplay({ x: 200, y: -700, width: 800, height: 600 }, [MAIN])).toBe(false);
  });
});

describe("decideWindowGeometry", () => {
  it("没有记录 → 默认尺寸、不给坐标（交系统居中）", () => {
    const g = decideWindowGeometry(undefined, [MAIN]);
    expect(g.x).toBeUndefined();
    expect(g.y).toBeUndefined();
    expect(g.width).toBeGreaterThanOrEqual(MIN_SIZE.width);
  });

  it("尺寸小于最小值（脏数据）→ 整体回退默认，不要把窗口开成一条缝", () => {
    const g = decideWindowGeometry({ bounds: { x: 10, y: 10, width: 100, height: 50 } }, [MAIN]);
    expect(g.width).toBeGreaterThanOrEqual(MIN_SIZE.width);
    expect(g.height).toBeGreaterThanOrEqual(MIN_SIZE.height);
    expect(g.x).toBeUndefined();
  });

  it("尺寸可信但位置在屏外 → **留住尺寸、丢掉坐标**（不是整体回退）", () => {
    const g = decideWindowGeometry({ bounds: { x: 1600, y: 200, width: 1000, height: 700 } }, [MAIN]);
    expect(g.width).toBe(1000);      // 用户拉过的宽度要留住
    expect(g.height).toBe(700);
    expect(g.x).toBeUndefined();     // 但绝不能照着屏外坐标开
    expect(g.y).toBeUndefined();
  });

  it("位置尺寸都可信 → 原样恢复", () => {
    const g = decideWindowGeometry({ bounds: { x: 120, y: 80, width: 1000, height: 700 }, maximized: false }, [MAIN]);
    expect(g).toEqual({ x: 120, y: 80, width: 1000, height: 700, maximized: false });
  });

  it("maximized 与 bounds 各记各的：坐标不可信时 maximized 仍要保留", () => {
    const g = decideWindowGeometry({ bounds: { x: 9999, y: 9999, width: 1000, height: 700 }, maximized: true }, [MAIN]);
    expect(g.maximized).toBe(true);
    expect(g.x).toBeUndefined();
  });

  it("bounds 里有 NaN（脏数据）→ 当作没有尺寸，回退默认", () => {
    const g = decideWindowGeometry({ bounds: { x: 0, y: 0, width: NaN, height: 700 } }, [MAIN]);
    expect(Number.isFinite(g.width)).toBe(true);
    expect(g.width).toBeGreaterThanOrEqual(MIN_SIZE.width);
  });
});
