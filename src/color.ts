// 取色器色值数学：HSV ↔ HEX、预设色板、区间钳制。
// 从 App.tsx 抽出（纯函数，无 React 依赖），单测见 appearance.test.ts。

export type HSVColor = { h: number; s: number; v: number };

export const COLOR_PRESETS = [
  "#e8edf1", "#acc8dc", "#1493cd",
  "#c7e5ca", "#c5e5a4", "#65b46d",
  "#d0d3af", "#aaad9d", "#898183",
  "#f7d2a5", "#f7b269", "#df8750",
  "#cad7e8", "#c8acd3", "#168f9a",
] as const;

export const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export function hsvToHex({ h, s, v }: HSVColor): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s) / 100;
  const val = clamp(v) / 100;
  const chroma = val * sat;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = val - chroma;
  const [r, g, b] = hue < 60 ? [chroma, x, 0]
    : hue < 120 ? [x, chroma, 0]
    : hue < 180 ? [0, chroma, x]
    : hue < 240 ? [0, x, chroma]
    : hue < 300 ? [x, 0, chroma]
    : [chroma, 0, x];
  return `#${[r, g, b].map((part) => Math.round((part + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToHSV(value: string): HSVColor {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return { h: 156, s: 32, v: 49 };
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return {
    h: (h + 360) % 360,
    s: max ? (delta / max) * 100 : 0,
    v: max * 100,
  };
}

export function hexToRGB(value: string): string {
  const normalized = hsvToHex(hexToHSV(value)).slice(1);
  return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16)).join(", ");
}
