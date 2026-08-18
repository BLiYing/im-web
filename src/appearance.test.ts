import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALLPAPER,
  DEFAULT_WALLPAPER_DARK,
  DEFAULT_WALLPAPER_LIGHT,
  WALLPAPER_PRESETS,
  resolveWallpaper,
  wallpaperCSS,
} from "./wallpaper";
import { hexToHSV, hsvToHex } from "./color";

describe("chat wallpaper appearance", () => {
  it("resolves every bundled preset to a CSS background", () => {
    for (const preset of WALLPAPER_PRESETS) {
      expect(wallpaperCSS({ kind: "preset", value: preset.id })).toBe(preset.css);
    }
  });

  it("falls back to the first preset for an unknown id", () => {
    expect(wallpaperCSS({ kind: "preset", value: "missing" })).toBe(WALLPAPER_PRESETS[0].css);
    expect(wallpaperCSS(DEFAULT_WALLPAPER)).toBeTruthy();
  });

  it("creates image and solid-color backgrounds", () => {
    expect(wallpaperCSS({ kind: "image", value: "data:image/png;base64,abc" }))
      .toBe('url("data:image/png;base64,abc") center / cover no-repeat');
    expect(wallpaperCSS({ kind: "color", value: "#123456" })).toBe("#123456");
  });

  it("resolves the auto default to a light or dark preset by theme", () => {
    expect(DEFAULT_WALLPAPER).toEqual({ kind: "auto" });
    // 两个默认 id 必须真实存在于目录中，否则会静默回退到第一张。
    const ids = WALLPAPER_PRESETS.map((p) => p.id);
    expect(ids).toContain(DEFAULT_WALLPAPER_LIGHT);
    expect(ids).toContain(DEFAULT_WALLPAPER_DARK);
    expect(resolveWallpaper({ kind: "auto" }, false)).toEqual({ kind: "preset", value: DEFAULT_WALLPAPER_LIGHT });
    expect(resolveWallpaper({ kind: "auto" }, true)).toEqual({ kind: "preset", value: DEFAULT_WALLPAPER_DARK });
    // 非 auto 的选择原样透传，不受 isDark 影响。
    expect(resolveWallpaper({ kind: "color", value: "#123456" }, true)).toEqual({ kind: "color", value: "#123456" });
  });

  it("renders the auto default differently in light vs dark", () => {
    const light = wallpaperCSS(DEFAULT_WALLPAPER, false);
    const dark = wallpaperCSS(DEFAULT_WALLPAPER, true);
    expect(light).toBe(WALLPAPER_PRESETS.find((p) => p.id === DEFAULT_WALLPAPER_LIGHT)!.css);
    expect(dark).toBe(WALLPAPER_PRESETS.find((p) => p.id === DEFAULT_WALLPAPER_DARK)!.css);
    expect(light).not.toBe(dark);
  });

  it("round-trips solid wallpaper colors through the HSV editor", () => {
    expect(hsvToHex(hexToHSV("#567e71"))).toBe("#567e71");
    expect(hsvToHex({ h: 0, s: 100, v: 100 })).toBe("#ff0000");
    expect(hsvToHex({ h: 120, s: 100, v: 100 })).toBe("#00ff00");
  });
});
