import { describe, it, expect } from "vitest";
import { avatarBaseScale, clampTranslate, cropSourceRect } from "./avatarCrop";

const CIRCLE = 180;

describe("avatarBaseScale", () => {
  it("正方形图：短边=圆直径 → baseScale = circle/边长", () => {
    expect(avatarBaseScale(200, 200, CIRCLE)).toBeCloseTo(0.9);
  });
  it("横图：以较短的高为准充满圆", () => {
    // 高 100 更短 → 180/100=1.8；宽方向会溢出（可平移）
    expect(avatarBaseScale(400, 100, CIRCLE)).toBeCloseTo(1.8);
  });
  it("竖图：以较短的宽为准充满圆", () => {
    expect(avatarBaseScale(100, 400, CIRCLE)).toBeCloseTo(1.8);
  });
});

describe("clampTranslate", () => {
  it("正方形图 @zoom1：短边恰好充满，无可平移空间", () => {
    const disp = 0.9; // baseScale×1
    const r = clampTranslate(50, -30, 200, 200, disp, CIRCLE);
    expect(r.tx).toBe(0);
    expect(Math.abs(r.ty)).toBe(0); // 可能为 -0（Math.max 语义），取绝对值归一
  });
  it("放大后允许平移，且对称夹紧到边界", () => {
    const disp = 1.8; // zoom≈2
    // 显示尺寸 360，半宽 180，maxX = 180 - 90 = 90
    expect(clampTranslate(999, -999, 200, 200, disp, CIRCLE)).toEqual({ tx: 90, ty: -90 });
    expect(clampTranslate(40, -20, 200, 200, disp, CIRCLE)).toEqual({ tx: 40, ty: -20 });
  });
  it("横图 @zoom1：宽向可平移、高向锁死", () => {
    const disp = 1.8; // baseScale(400,100)=1.8
    // 宽 400×1.8=720 半宽360 maxX=360-90=270；高 100×1.8=180 半高90 maxY=0
    expect(clampTranslate(500, 50, 400, 100, disp, CIRCLE)).toEqual({ tx: 270, ty: 0 });
  });
});

describe("cropSourceRect", () => {
  it("居中正方形 @zoom1：整图映射为圆的外接正方形", () => {
    const disp = 0.9;
    expect(cropSourceRect(200, 200, disp, 0, 0, CIRCLE)).toEqual({ sx: 0, sy: 0, size: 200 });
  });
  it("放大居中：裁源图正中的较小正方形", () => {
    const disp = 1.8; // zoom≈2
    const r = cropSourceRect(200, 200, disp, 0, 0, CIRCLE);
    expect(r.sx).toBeCloseTo(50);
    expect(r.sy).toBeCloseTo(50);
    expect(r.size).toBeCloseTo(100);
  });
  it("平移后源矩形随之偏移（正 tx → 源 x 减小）", () => {
    const disp = 1.8;
    const base = cropSourceRect(200, 200, disp, 0, 0, CIRCLE).sx;
    const moved = cropSourceRect(200, 200, disp, 18, 0, CIRCLE).sx;
    expect(moved).toBeCloseTo(base - 18 / disp);
  });
});
