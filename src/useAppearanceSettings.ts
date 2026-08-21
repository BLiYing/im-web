// useAppearanceSettings：外观/通用设置簇（阶段 8a，CODING_STYLE §7「①自有状态+一组操作」）——主题/跟随系统深色/字号/时间格式/
// 发送键/壁纸/壁纸模糊/取色面板 + 各自的「写 DOM 变量 + localStorage 持久化」effect + 壁纸四操作 + isDark 派生。
// 函数体逐字平移；副作用依赖仅 setToast。面板开合（showSettings/generalOpen/dataStorageOpen/wallpaperOpen…）中，
// wallpaperOpen/wallpaperColorOpen 随簇进来（仅壁纸子面板用），其余留 App。
import { useEffect, useState } from "react";
import { DEFAULT_WALLPAPER, loadWallpaper, wallpaperCSS, type WallpaperChoice } from "./wallpaper";
import { clamp, hsvToHex, hexToHSV, type HSVColor } from "./color";

export function useAppearanceSettings(setToast: (msg: string | null) => void) {
  const [wallpaperOpen, setWallpaperOpen] = useState(false); // 通用设置 ▸ 聊天壁纸
  const [wallpaper, setWallpaper] = useState<WallpaperChoice>(loadWallpaper);
  const [wallpaperBlur, setWallpaperBlur] = useState(() => localStorage.getItem("im.wallpaperBlur") === "1");
  const [wallpaperColorOpen, setWallpaperColorOpen] = useState(false);
  const [colorHSV, setColorHSV] = useState<HSVColor>(() => hexToHSV("#567e71"));
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => (localStorage.getItem("im.theme") as "light" | "dark" | "system") || "system");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem("im.fontSize")) || 15);
  const [timeFormat, setTimeFormat] = useState<"12" | "24">(() => (localStorage.getItem("im.timeFormat") as "12" | "24") || "24");
  const [sendKey, setSendKey] = useState<"enter" | "cmd">(() => (localStorage.getItem("im.sendKey") as "enter" | "cmd") || "enter");

  // 主题：真功能——写 <html data-theme> 驱动 CSS 变量切换（浅/深/跟随系统）+ 持久化。
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("im.theme", theme);
  }, [theme]);
  // 监听系统深色偏好变化（仅影响 theme==="system"）；用于自动壁纸随明暗切换。
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // 当前实际是否深色：显式 dark，或跟随系统且系统为深色。
  const isDark = theme === "dark" || (theme === "system" && systemDark);
  // 消息字体大小：真功能——写 CSS 变量 --msg-font 驱动消息气泡文本字号 + 持久化。
  useEffect(() => {
    localStorage.setItem("im.fontSize", String(fontSize));
    document.documentElement.style.setProperty("--msg-font", `${fontSize}px`);
  }, [fontSize]);
  useEffect(() => { localStorage.setItem("im.timeFormat", timeFormat); }, [timeFormat]);
  useEffect(() => { localStorage.setItem("im.sendKey", sendKey); }, [sendKey]);
  useEffect(() => {
    // 依赖 isDark：auto 壁纸在明暗切换时需重新解析（深色默认 midnight / 浅色默认 dawn）。
    document.documentElement.style.setProperty("--chat-wallpaper", wallpaperCSS(wallpaper, isDark));
    try {
      localStorage.setItem("im.wallpaper", JSON.stringify(wallpaper));
    } catch {
      setToast("图片较大，壁纸仅在本次页面有效");
    }
  }, [wallpaper, isDark]);
  useEffect(() => {
    document.documentElement.style.setProperty("--wallpaper-blur", wallpaperBlur ? "10px" : "0px");
    document.documentElement.style.setProperty("--wallpaper-scale", wallpaperBlur ? "1.06" : "1");
    localStorage.setItem("im.wallpaperBlur", wallpaperBlur ? "1" : "0");
  }, [wallpaperBlur]);

  const pickWallpaperImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setToast("请选择图片文件");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setToast("图片不能超过 8 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setWallpaper({ kind: "image", value: reader.result });
    };
    reader.onerror = () => setToast("读取图片失败");
    reader.readAsDataURL(file);
  };

  const resetWallpaper = () => {
    setWallpaper(DEFAULT_WALLPAPER);
    setWallpaperBlur(false);
  };

  const applyWallpaperColor = (next: HSVColor) => {
    const normalized = { h: clamp(next.h, 0, 360), s: clamp(next.s), v: clamp(next.v) };
    setColorHSV(normalized);
    setWallpaper({ kind: "color", value: hsvToHex(normalized) });
  };

  const openWallpaperColor = () => {
    setColorHSV(hexToHSV(wallpaper.kind === "color" ? wallpaper.value : "#567e71"));
    setWallpaperColorOpen(true);
  };

  return {
    theme, setTheme, isDark, fontSize, setFontSize, timeFormat, setTimeFormat, sendKey, setSendKey,
    wallpaper, setWallpaper, wallpaperBlur, setWallpaperBlur, wallpaperOpen, setWallpaperOpen,
    wallpaperColorOpen, setWallpaperColorOpen, colorHSV,
    pickWallpaperImage, resetWallpaper, applyWallpaperColor, openWallpaperColor,
  };
}
