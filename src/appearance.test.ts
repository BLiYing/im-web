import { describe, expect, it } from "vitest";
import { DEFAULT_WALLPAPER, WALLPAPER_PRESETS, hexToHSV, hsvToHex, wallpaperCSS } from "./App";

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

  it("round-trips solid wallpaper colors through the HSV editor", () => {
    expect(hsvToHex(hexToHSV("#567e71"))).toBe("#567e71");
    expect(hsvToHex({ h: 0, s: 100, v: 100 })).toBe("#ff0000");
    expect(hsvToHex({ h: 120, s: 100, v: 100 })).toBe("#00ff00");
  });
});
