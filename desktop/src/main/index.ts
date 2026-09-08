// Electron 主进程：建窗口、决定加载哪份页面、把身份交给 preload。
//
// D2 的验收目标只有一条：**登录 → 会话列表 → 收发一条消息**。所以这里刻意只做窗口与身份，
// 托盘 / 通知 / 自启 / 单实例锁 / 关闭最小化统统归 D4——那些每加一件都要在两个平台各验一次，
// 混进 D2 会让「骨架到底通没通」失去判据。
import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
import { BRIDGE_CONTRACT, deviceName, rememberedLocalPort, rememberLocalPort, stableDeviceId } from "./identity";
import { runSmoke } from "./smoke";
import { runE2E } from "./e2e";
import { startLocalServer, type LocalServerHandle } from "./localServer";
import { runPerf } from "./perf";

/** 开发时加载 Vite dev server（吃热更新），打包后加载随包的 dist/。
 *  `IM_DEV_URL` 允许压测/多实例时指向别的端口，与后端 dev.sh 的用法对齐。 */
const DEV_URL = process.env.IM_DEV_URL || "http://localhost:5173";

/** 未打包时 dist/ 在仓库根：out/main → out → desktop → im-web。打包后由 electron-builder 放进 app 根。 */
function distDir(): string {
  return app.isPackaged ? join(app.getAppPath(), "dist") : join(__dirname, "../../..", "dist");
}

/** 后端地址。与仓库根 vite.config.ts 的 `IM_SERVER_TARGET` **同名同默认**，压测/多后端联调时口径一致。 */
function backendOrigin(): string {
  return process.env.IM_SERVER_TARGET || "http://localhost:8080";
}

/**
 * 打包后不能直接 loadFile(dist/index.html)：`file://` 下 im-web 的相对路径 API 全部打不出去
 * （实测 origin=file:// → fetch('/api/…') Failed to fetch），而后端又没有 CORS。
 * 故起一个本地同源层（方案 B，见 localServer.ts 顶部与 DESKTOP_DESIGN §7.5）。
 * `IM_FORCE_LOCAL_SERVER=1` 让未打包时也走这条，便于不重新打包就验证它。
 */
function useLocalServer(): boolean {
  return app.isPackaged || process.env.IM_FORCE_LOCAL_SERVER === "1";
}

/** `--smoke`：无人值守自检（见 smoke.ts）。走的与真实启动**完全同一条路**——
 *  自检若绕开 createWindow，它证明不了任何东西。唯一的差别是不把窗口显出来。 */
const smokeMode = process.argv.includes("--smoke");
/** `--e2e`：D2 的验收链路自检（见 e2e.ts）。同样不显窗口。 */
const e2eMode = process.argv.includes("--e2e");
/** `--perf`：D3 性能实测（见 perf.ts）。同样不显窗口——显窗口会把合成器开销算进来，那是另一码事。 */
const perfMode = process.argv.includes("--perf");

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 720,        // 再窄下去 im-web 的双栏（侧栏 + 聊天）会挤成一坨
    minHeight: 560,
    show: false,          // 先隐藏，ready-to-show 再显——否则用户会看到一闪而过的白屏
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,   // 与 nodeIntegration:false 一起，是「桥只有一座」的强制手段
      nodeIntegration: false,
      // 身份两项作为**值**同步交给 preload（见 identity.ts 顶部的理由）。
      additionalArguments: [
        `--im-contract=${BRIDGE_CONTRACT}`,
        `--im-device-id=${stableDeviceId()}`,
        `--im-device-name=${deviceName()}`,
      ],
    },
  });
  win.once("ready-to-show", () => { if (!smokeMode && !e2eMode && !perfMode) win.show(); });
  return win;
}

let localServer: LocalServerHandle | null = null;

/** 启动失败时把话说出来。**没有这个的后果是「窗口永不出现且零报错」**——
 *  show:false + 只在 ready-to-show 才 show()，一旦 whenReady 链里抛了，用户看到的是
 *  「点了图标什么也没发生」。最常见的触发是仓库根没跑 npm run dev（/code-review 抓到）。 */
function fatal(stage: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`[im-desktop] 启动失败（${stage}）：${msg}\n`);
  if (!app.isPackaged && msg.includes("ERR_CONNECTION_REFUSED")) {
    process.stderr.write("[im-desktop]   dev 模式要先在仓库根跑 `npm run dev`（Vite :5173）\n");
  }
  dialog.showErrorBox("IM Desktop 启动失败", `${stage}：${msg}`);
  app.exit(1);
}

app.whenReady().then(async () => {
  const win = createWindow();
  if (useLocalServer()) {
    try {
      localServer = await startLocalServer(distDir(), backendOrigin(), rememberedLocalPort());
      rememberLocalPort(localServer.port);   // 下次复用同一个端口 → origin 稳定 → localStorage 不丢
    } catch (e) {
      fatal("起本地同源层", e);
      return;
    }
  }
  const target = localServer ? localServer.url : DEV_URL;
  const load = win.loadURL(target);

  if (smokeMode || e2eMode || perfMode) {
    const say = (s: string): void => { process.stdout.write(`${s}\n`); };
    const code = perfMode ? await runPerf(win, load, say)
      : e2eMode ? await runE2E(win, load, say)
      : await runSmoke(win, target, load);
    // **必须 app.exit(code)，不能 `process.exitCode = code` + app.quit()**：后者实测退出码恒为 0
    // （2026-09-07 打包版自检明明报红却 exit 0）。门禁 fail-open 比没有门禁更糟——
    // 它会让人以为验过了。同理见 IMServer scripts/check-*.sh 的 --selftest。
    app.exit(code);
    return;
  }
  try {
    await load;
  } catch (e) {
    fatal("加载页面", e);
    return;
  }

  app.on("activate", () => {
    // macOS：Dock 图标被点、且没有窗口时重开一个（系统惯例，不是可选项）。
    // **必须用同一个 target**——写死 DEV_URL 会让打包版重开的窗口打到不存在的 :5173。
    if (BrowserWindow.getAllWindows().length === 0) createWindow().loadURL(target);
  });
});

// 本地服务是常驻资源，退出前停掉。
// ⚠️ **`server.close()` 只停止接新连接，拆不掉已建立的 WS 长连接**（/code-review 指出：
// 原注释说它能防端口/fd 累积，那是不对的——真正回收靠的是进程退出，且 smoke/e2e/perf 走
// `app.exit()` 压根不触发 will-quit）。D4 若加「关闭=最小化到托盘」而需要在不退进程的前提下
// 重建服务，这里必须改成记下活连接并逐个 destroy。
app.on("will-quit", () => { localServer?.close(); localServer = null; });

app.on("window-all-closed", () => {
  // macOS 的惯例是关窗不退应用；Windows/Linux 关窗即退。
  // D4 会把 macOS 这条改成「关闭 = 最小化到托盘」，那时两平台都要重验。
  if (process.platform !== "darwin") app.quit();
});
