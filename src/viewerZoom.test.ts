import { describe, it, expect } from "vitest";
import { ZOOM_IDENTITY, ZOOM_MAX, clampPan, clampScale, wheelFactor, zoomAt } from "./viewerZoom";

const base = { w: 800, h: 600 };
const viewport = { w: 1000, h: 700 };

describe("clampScale", () => {
  it("钳到 [1, 5]；贴近 1 吸附回 1；非法值回 1", () => {
    expect(clampScale(0.3)).toBe(1);
    expect(clampScale(1.01)).toBe(1);
    expect(clampScale(1.5)).toBe(1.5);
    expect(clampScale(99)).toBe(ZOOM_MAX);
    expect(clampScale(NaN)).toBe(1);
  });

  it("只在缩小方向吸附：从 1× 起的微小放大保留，否则细碎的滚轮/捏合事件永远累计不上去", () => {
    expect(clampScale(1.005, 1)).toBe(1.005);
    expect(clampScale(1.01, 1.005)).toBe(1.01);
    expect(clampScale(1.01, 1.03)).toBe(1); // 往回缩到贴近 1× → 吸附
  });
});

describe("clampPan — 图拖不出屏幕", () => {
  it("放大后仍不比视口大的轴锁在正中", () => {
    // 1.1×：880×660，两轴都小于 1000×700
    expect(clampPan({ scale: 1.1, x: 300, y: -300 }, base, viewport)).toEqual({ scale: 1.1, x: 0, y: 0 });
  });

  it("比视口大的轴最多拖到图边贴住视口边", () => {
    // 2×：1600×1200 → 可拖范围 ±300 / ±250
    expect(clampPan({ scale: 2, x: 999, y: -999 }, base, viewport)).toEqual({ scale: 2, x: 300, y: -250 });
    expect(clampPan({ scale: 2, x: 120, y: -80 }, base, viewport)).toEqual({ scale: 2, x: 120, y: -80 });
  });

  it("只有一轴超出：那一轴可拖，另一轴仍居中", () => {
    // 1.5×：1200×900 → 两轴都超；换个宽视口只让 y 超
    expect(clampPan({ scale: 1.5, x: 50, y: 50 }, base, { w: 2000, h: 700 })).toEqual({ scale: 1.5, x: 0, y: 50 });
  });
});

describe("zoomAt — 以鼠标位置为不动点", () => {
  it("鼠标底下的那一点缩放前后不动", () => {
    const anchor = { x: 100, y: 50 };
    const s = zoomAt(ZOOM_IDENTITY, 2, anchor, base, viewport);
    expect(s).toEqual({ scale: 2, x: -100, y: -50 });
    // 图上的点 p 落在屏幕 t + k·p：缩放前 p=anchor（k=1,t=0），缩放后仍应落在 anchor
    expect({ x: s.x + s.scale * anchor.x, y: s.y + s.scale * anchor.y }).toEqual(anchor);
  });

  it("连续两次缩放，不动点仍成立", () => {
    const anchor = { x: -120, y: 80 };
    const a = zoomAt(ZOOM_IDENTITY, 2, anchor, base, viewport);
    const b = zoomAt(a, 3, anchor, base, viewport);
    const p = { x: (anchor.x - a.x) / a.scale, y: (anchor.y - a.y) / a.scale };
    expect(b.x + b.scale * p.x).toBeCloseTo(anchor.x);
    expect(b.y + b.scale * p.y).toBeCloseTo(anchor.y);
  });

  it("在图的角上放大：不动点让位给钳制，不露多余黑边", () => {
    const s = zoomAt(ZOOM_IDENTITY, 2, { x: 400, y: 300 }, base, viewport);
    expect(s).toEqual({ scale: 2, x: -300, y: -250 });
  });

  it("缩回 1×（含吸附）即复位平移；超上限钳到 5×", () => {
    const zoomed = { scale: 3, x: 200, y: -100 };
    expect(zoomAt(zoomed, 1, { x: 10, y: 10 }, base, viewport)).toEqual(ZOOM_IDENTITY);
    expect(zoomAt(zoomed, 1.01, { x: 10, y: 10 }, base, viewport)).toEqual(ZOOM_IDENTITY);
    expect(zoomAt(zoomed, 50, { x: 0, y: 0 }, base, viewport).scale).toBe(ZOOM_MAX);
  });
});

describe("细碎滚轮事件能累计放大（高精度触控板每个事件只有一两个像素）", () => {
  it("连续 40 个 deltaY=-2 的事件从 1× 放大到约 1.17×", () => {
    let s = ZOOM_IDENTITY;
    for (let i = 0; i < 40; i++) s = zoomAt(s, s.scale * wheelFactor(-2, 0, false), { x: 0, y: 0 }, base, viewport);
    expect(s.scale).toBeCloseTo(Math.exp(0.16));
  });
});

describe("wheelFactor", () => {
  it("向上滚放大、向下滚缩小，且互为倒数", () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(-100, 0, false) * wheelFactor(100, 0, false)).toBeCloseTo(1);
  });

  it("捏合（ctrl+wheel）比同样 delta 的滚轮灵敏", () => {
    expect(wheelFactor(-10, 0, true)).toBeGreaterThan(wheelFactor(-10, 0, false));
  });

  it("按行滚（deltaMode=1）折算成像素；单次事件封顶", () => {
    expect(wheelFactor(-3, 1, false)).toBeCloseTo(wheelFactor(-48, 0, false));
    expect(wheelFactor(-100000, 0, false)).toBeCloseTo(Math.exp(0.5));
    expect(wheelFactor(100000, 0, true)).toBeCloseTo(Math.exp(-0.5));
  });
});
