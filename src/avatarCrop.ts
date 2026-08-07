// 头像圆形裁切的纯几何计算（方案 C · Web）。从 AvatarCropper 抽出便于单测：
// 只做坐标/尺寸换算，不碰 canvas/DOM/React。

// AVATAR_OUT 输出头像边长（正方形，px）。存方图、显示时切圆。
export const AVATAR_OUT = 256;

// avatarBaseScale：zoom=1 时的基准缩放，使图片**短边恰好充满圆**（再放大只会更满）。
export function avatarBaseScale(imgW: number, imgH: number, circle: number): number {
  return Math.max(circle / imgW, circle / imgH);
}

// clampTranslate：约束平移量，保证图片始终盖住整个圆（圆内不露白）。
// disp = baseScale × zoom 为当前显示缩放。返回夹紧后的 {tx, ty}。
export function clampTranslate(
  tx: number,
  ty: number,
  imgW: number,
  imgH: number,
  disp: number,
  circle: number,
): { tx: number; ty: number } {
  const maxX = Math.max(0, (imgW * disp) / 2 - circle / 2);
  const maxY = Math.max(0, (imgH * disp) / 2 - circle / 2);
  return {
    tx: Math.min(maxX, Math.max(-maxX, tx)),
    ty: Math.min(maxY, Math.max(-maxY, ty)),
  };
}

// cropSourceRect：圆的外接正方形映射回**源图坐标系**的矩形（drawImage 的源参数）。
// 画布点 (X,Y) → 源图 sx = (X - (cx + tx - imgW·disp/2)) / disp；取正方形左上角 (cx-r, cy-r)。
export function cropSourceRect(
  imgW: number,
  imgH: number,
  disp: number,
  tx: number,
  ty: number,
  circle: number,
): { sx: number; sy: number; size: number } {
  const r = circle / 2;
  return {
    sx: (-r - tx + (imgW * disp) / 2) / disp,
    sy: (-r - ty + (imgH * disp) / 2) / disp,
    size: (2 * r) / disp,
  };
}
