// 「与外部世界打交道」的两件宿主能力：另存到磁盘 / 用系统浏览器打开。
// 契约见 im-web 的 `src/platform/types.ts`（`saveFile` / `openExternal`）。
//
// 这两件都**只能由外壳做**：浏览器版分别是 `<a download>` 与 `window.open`，
// 在桌面上前者会静默落进「下载」目录（用户选不了位置），后者只是又开一个应用内窗口。

import { app, dialog, net, shell, type BrowserWindow } from "electron";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** 允许交给系统去打开的协议。**白名单，不是黑名单**——见 `openExternal` 的注释。 */
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * 这个 URL 能不能交给系统打开。
 *
 * ⚠️ **必须是白名单**。`shell.openExternal` 会把 URL 交给操作系统按协议分发，
 * 而 `file://` 能打开本机任意路径、自定义协议能唤起任意已注册的应用——
 * 页面里一个被诱导的链接就成了任意程序启动器。这是 Electron 上被写进无数篇报告的老洞。
 * 页面本身也不该出现这些协议：`openExternal` 的调用点只有媒体预览（http(s)）。
 */
export function isExternallyOpenable(raw: string): boolean {
  try {
    return EXTERNAL_SCHEMES.has(new URL(raw).protocol);
  } catch {
    return false;   // 相对路径 / 非法 URL 一律不放行
  }
}

/** 用系统默认应用打开。**不抛**：调用方是 fire-and-forget 的（同步语义，见契约）。 */
export function openExternal(raw: string): void {
  if (!isExternallyOpenable(raw)) {
    process.stderr.write(`[im-desktop] openExternal 拒绝非白名单协议：${raw.slice(0, 80)}\n`);
    return;
  }
  void shell.openExternal(raw).catch((e: unknown) => {
    process.stderr.write(`[im-desktop] openExternal 失败：${e instanceof Error ? e.message : String(e)}\n`);
  });
}

/** `saveFile` 的入参：要么给字节（blob: 只有渲染进程够得到），要么给一个主进程能取的绝对 URL。 */
export interface SaveFileReq {
  name: string;
  /** 绝对 http(s) URL；与 `bytes` 二选一。 */
  url?: string;
  /** 已经读好的字节（blob:/data: 走这条）；与 `url` 二选一。 */
  bytes?: ArrayBuffer | Uint8Array;
}

/**
 * 另存到用户选的位置。**返回是否真的写成了**——但注意「用户点了取消」也返回 false，
 * 那不是失败，所以调用方不该据此报错（契约里这个方法是 `Promise<void>`，
 * 这里的返回值只给自检与日志用）。
 *
 * 两条路是刻意的：
 * - **字节**：`blob:` URL 活在渲染进程的 origin 里，主进程 `net.fetch` 取不到，只能让渲染进程读好递过来。
 * - **URL**：远端媒体最大可到 1.5 GB（`MAX_AUTO_BYTES`），走 `net.fetch` **流式**落盘，
 *   不把整个文件读进内存——这也是浏览器版 `<a download>` 的行为，别为了"统一"退化成先读进内存。
 *   用 `net.fetch` 而不是 node 的 fetch：它走 Chromium 的网络栈，能带上渲染进程那个 session
 *   的 cookie 与代理设置（打包版的媒体走本地同源层）。
 */
export async function saveFile(win: BrowserWindow | null, req: SaveFileReq): Promise<boolean> {
  const suggested = basename(req.name || "download") || "download";
  let filePath: string | undefined;
  try {
    const picked = win
      ? await dialog.showSaveDialog(win, { defaultPath: suggested })
      : await dialog.showSaveDialog({ defaultPath: suggested });
    if (picked.canceled || !picked.filePath) return false;   // 用户取消：不是错误，不要报
    filePath = picked.filePath;
  } catch (e) {
    process.stderr.write(`[im-desktop] 保存对话框失败：${e instanceof Error ? e.message : String(e)}\n`);
    return false;
  }
  try {
    if (req.bytes) {
      await writeFile(filePath, Buffer.from(req.bytes instanceof Uint8Array ? req.bytes : new Uint8Array(req.bytes)));
      return true;
    }
    if (!req.url) return false;
    // 走**渲染进程那个 session** 的 fetch，而不是裸 net.fetch：这样带得上它的 cookie 与代理
    // （打包版的媒体走本地同源层）。session 拿不到时退回 net.fetch，至少同源公开资源还能取。
    const res = win ? await win.webContents.session.fetch(req.url) : await net.fetch(req.url);
    if (!res.ok || !res.body) {
      process.stderr.write(`[im-desktop] 另存失败：HTTP ${res.status} ${req.url.slice(0, 120)}\n`);
      return false;
    }
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(filePath));
    return true;
  } catch (e) {
    process.stderr.write(`[im-desktop] 另存失败：${e instanceof Error ? e.message : String(e)}\n`);
    return false;
  }
}

/** 仅供自检：`app` 是否可用（`--shell-check` 里用来确认本模块被真的装进了主进程）。 */
export const capsReady = (): boolean => app.isReady();
