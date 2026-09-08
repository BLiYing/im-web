// 托盘图标 + 「关闭 = 收起到托盘」。
//
// 这是桌面端相对浏览器版最实在的一条增益：关掉窗口消息还在收，来了消息托盘能提示
// （角标与通知在 D4-2，本轮先把托盘与生命周期做对）。
//
// **生命周期比图标难**。三条容易做错的：
//   ① 关窗 ≠ 退出，但用户从托盘菜单点「退出」必须真退——要一个显式的 isQuitting 闸，
//      否则 app.quit() 会再次触发 close 事件、又被 preventDefault 收进托盘，永远退不掉。
//   ② macOS 的惯例本来就是关窗不退，但 Dock 图标点一下要能把窗口召回来（activate）。
//   ③ 托盘图标必须**留一个强引用**。Tray 被 GC 掉图标就从菜单栏消失，
//      这是 Electron 老生常谈的坑，且现象是「过一会儿自己没了」，极难联想到 GC。
import { app, Menu, Tray, type BrowserWindow } from "electron";
import { join } from "node:path";

/** ③ 的强引用。模块级变量，别改成局部。 */
let tray: Tray | null = null;

/** 用户是否真的要退出（区别于「关窗收进托盘」）。见 ①。 */
let quitting = false;
export function isQuitting(): boolean { return quitting; }
export function beginQuit(): void { quitting = true; }

/** 图标在包内的位置：未打包时 out/main → out → desktop → resources；打包后随 extraResources 走。 */
function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "tray.png")
    : join(__dirname, "../..", "resources/tray.png");
}

function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * 装托盘，并把窗口的 close 改成「收起」。返回拆除函数（测试与热重启用）。
 *
 * 注意 `win.on("close")` 里**不能**直接 `win.hide()` 就完事：必须 `preventDefault()`，
 * 否则窗口对象会被销毁，下次从托盘点「显示」就没有窗口可显了。
 */
/** 设托盘 tooltip（未读数就挂在这儿）。托盘还没装时静默忽略——启动早期可能就有未读来了。 */
export function setTrayTooltip(text: string): void {
  if (tray && !tray.isDestroyed()) tray.setToolTip(text);
}

export function installTray(win: BrowserWindow): () => void {
  tray = new Tray(trayIconPath());
  tray.setToolTip("IM Desktop");

  const menu = Menu.buildFromTemplate([
    { label: "显示主窗口", click: () => showWindow(win) },
    { type: "separator" },
    // 这一条是唯一能真退出的入口——点它才把 quitting 置上。
    { label: "退出 IM Desktop", click: () => { beginQuit(); app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  // 左键点托盘：Windows/Linux 的习惯是切换显示；macOS 左键默认就弹菜单，这里不额外接管。
  if (process.platform !== "darwin") {
    tray.on("click", () => { if (win.isVisible()) win.hide(); else showWindow(win); });
  }

  const onClose = (e: Electron.Event): void => {
    if (quitting) return;          // 真退出：放行，让窗口正常销毁
    e.preventDefault();
    win.hide();
  };
  win.on("close", onClose);

  return () => {
    win.off("close", onClose);
    tray?.destroy();
    tray = null;
  };
}
