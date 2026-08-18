// 聊天壁纸：偏好类型、内置目录（浅/深各若干张）、加载与解析。
// 从 App.tsx 抽出（纯逻辑，无 React 依赖），单测见 appearance.test.ts。

export type WallpaperChoice =
  | { kind: "preset"; value: string }
  | { kind: "image"; value: string }
  | { kind: "color"; value: string }
  | { kind: "auto" }; // 跟随深/浅色模式，使用内置默认壁纸（浅色 DEFAULT_WALLPAPER_LIGHT / 深色 DEFAULT_WALLPAPER_DARK）

// 未显式选择时的内置默认：浅色一张、深色一张，随外观模式自动切换（对齐 UI_COLOR.md「壁纸须同时提供浅深值」）。
export const DEFAULT_WALLPAPER_LIGHT = "dawn";
export const DEFAULT_WALLPAPER_DARK = "midnight";
export const DEFAULT_WALLPAPER: WallpaperChoice = { kind: "auto" };
// 壁纸目录：柔和分层渐变（多层 radial 光晕 + 一层 linear 底），低对比以保证气泡可读。
// tone 仅供设置页分组展示；浅色 6 张、深色 8 张。改 css 不影响已存偏好（按 id 解析）。
export const WALLPAPER_PRESETS = [
  // —— 浅色 ——
  { id: "dawn", tone: "light", label: "晨曦微光", css: "radial-gradient(circle at 22% 18%, #ffe6cf 0%, transparent 46%), radial-gradient(circle at 82% 80%, #d3e2ff 0%, transparent 52%), linear-gradient(160deg, #fdf4ec 0%, #eef2fb 100%)" },
  { id: "mint", tone: "light", label: "薄荷晨雾", css: "radial-gradient(circle at 78% 20%, #d8f3e5 0%, transparent 48%), radial-gradient(circle at 16% 82%, #e8f6da 0%, transparent 52%), linear-gradient(160deg, #f4fbf7 0%, #e9f5ee 100%)" },
  { id: "blossom", tone: "light", label: "樱粉", css: "radial-gradient(circle at 24% 20%, #ffdbe7 0%, transparent 46%), radial-gradient(circle at 82% 78%, #e7dcff 0%, transparent 52%), linear-gradient(160deg, #fff1f5 0%, #f2ecff 100%)" },
  { id: "sky", tone: "light", label: "晴空", css: "radial-gradient(circle at 80% 14%, #dcefff 0%, transparent 50%), radial-gradient(circle at 20% 86%, #eaf6ff 0%, transparent 54%), linear-gradient(165deg, #ecf6ff 0%, #d9ecfb 100%)" },
  { id: "sand", tone: "light", label: "暖沙", css: "radial-gradient(circle at 78% 20%, #ffeccb 0%, transparent 48%), radial-gradient(circle at 18% 84%, #fbf0dd 0%, transparent 52%), linear-gradient(160deg, #fdf4e6 0%, #f2e3cd 100%)" },
  { id: "meadow", tone: "light", label: "青草", css: "radial-gradient(circle at 24% 18%, #e4f3c9 0%, transparent 46%), radial-gradient(circle at 80% 80%, #c7e8cf 0%, transparent 52%), linear-gradient(160deg, #eef7dc 0%, #d3ebd6 100%)" },
  // —— 深色 ——
  { id: "midnight", tone: "dark", label: "午夜蓝", css: "radial-gradient(circle at 18% 14%, rgba(58,104,180,0.42) 0%, transparent 46%), radial-gradient(circle at 84% 82%, rgba(92,74,172,0.40) 0%, transparent 50%), linear-gradient(160deg, #0f1830 0%, #0a1120 58%, #131a34 100%)" },
  { id: "aurora", tone: "dark", label: "极光", css: "radial-gradient(circle at 22% 20%, rgba(46,196,150,0.40) 0%, transparent 44%), radial-gradient(circle at 78% 28%, rgba(58,122,212,0.38) 0%, transparent 48%), radial-gradient(circle at 60% 86%, rgba(122,92,202,0.32) 0%, transparent 52%), linear-gradient(165deg, #081018 0%, #0a1622 55%, #0d1120 100%)" },
  { id: "nebula", tone: "dark", label: "星云", css: "radial-gradient(circle at 26% 22%, rgba(168,74,196,0.42) 0%, transparent 44%), radial-gradient(circle at 78% 74%, rgba(74,86,204,0.40) 0%, transparent 48%), linear-gradient(160deg, #150b24 0%, #0e0a1c 58%, #1a1030 100%)" },
  { id: "abyss", tone: "dark", label: "深海", css: "radial-gradient(circle at 24% 82%, rgba(30,154,174,0.38) 0%, transparent 46%), radial-gradient(circle at 82% 20%, rgba(42,94,164,0.40) 0%, transparent 48%), linear-gradient(165deg, #071319 0%, #05141c 55%, #0a1a24 100%)" },
  { id: "ember", tone: "dark", label: "暖夜余烬", css: "radial-gradient(circle at 80% 16%, rgba(232,124,72,0.38) 0%, transparent 44%), radial-gradient(circle at 18% 82%, rgba(196,62,94,0.34) 0%, transparent 48%), linear-gradient(160deg, #1c1114 0%, #150d12 58%, #241318 100%)" },
  { id: "twilight", tone: "dark", label: "暮色", css: "radial-gradient(circle at 72% 78%, rgba(126,88,196,0.40) 0%, transparent 50%), radial-gradient(circle at 20% 18%, rgba(58,96,168,0.34) 0%, transparent 48%), linear-gradient(170deg, #101a30 0%, #17203b 45%, #211a38 100%)" },
  { id: "forest-night", tone: "dark", label: "林夜", css: "radial-gradient(circle at 20% 22%, rgba(62,152,112,0.34) 0%, transparent 46%), radial-gradient(circle at 84% 80%, rgba(40,112,122,0.32) 0%, transparent 48%), linear-gradient(160deg, #0b1712 0%, #08130f 58%, #0e1a15 100%)" },
  { id: "graphite", tone: "dark", label: "石墨", css: "radial-gradient(circle at 30% 20%, rgba(124,134,156,0.16) 0%, transparent 52%), radial-gradient(circle at 82% 84%, rgba(90,100,120,0.14) 0%, transparent 52%), linear-gradient(160deg, #1a1c22 0%, #141519 60%, #202329 100%)" },
] as const;

export function loadWallpaper(): WallpaperChoice {
  try {
    const value = JSON.parse(localStorage.getItem("im.wallpaper") || "null") as WallpaperChoice | null;
    if (value?.kind === "auto") return { kind: "auto" };
    if (value && ["preset", "image", "color"].includes(value.kind) && typeof (value as { value?: unknown }).value === "string") return value;
  } catch { /* 非法偏好回退默认值 */ }
  return DEFAULT_WALLPAPER;
}

// 把 auto 解析成当前外观下的具体默认预设；其余原样返回。分离出来便于单测与在渲染层按 isDark 求值。
export function resolveWallpaper(choice: WallpaperChoice, isDark: boolean): Exclude<WallpaperChoice, { kind: "auto" }> {
  if (choice.kind === "auto") return { kind: "preset", value: isDark ? DEFAULT_WALLPAPER_DARK : DEFAULT_WALLPAPER_LIGHT };
  return choice;
}

export function wallpaperCSS(choice: WallpaperChoice, isDark = false): string {
  const resolved = resolveWallpaper(choice, isDark);
  if (resolved.kind === "image") return `url("${resolved.value}") center / cover no-repeat`;
  if (resolved.kind === "color") return resolved.value;
  return WALLPAPER_PRESETS.find((item) => item.id === resolved.value)?.css ?? WALLPAPER_PRESETS[0].css;
}
