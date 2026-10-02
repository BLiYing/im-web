// Electron 主进程：建窗口、决定加载哪份页面、把身份交给 preload。
//
// D2 的验收目标只有一条：**登录 → 会话列表 → 收发一条消息**。所以这里刻意只做窗口与身份，
// 托盘 / 通知 / 自启 / 单实例锁 / 关闭最小化统统归 D4——那些每加一件都要在两个平台各验一次，
// 混进 D2 会让「骨架到底通没通」失去判据。
import { app, BrowserWindow, dialog, globalShortcut, ipcMain } from "electron";
import { join } from "node:path";
import { BRIDGE_CONTRACT, deviceName, readLocalState, rememberedLocalPort, rememberLocalPort, stableDeviceId, writeLocalState } from "./identity";
import { createGlobalShortcut, toggleActionFor } from "./globalShortcutCap";
import { runSmoke } from "./smoke";
import { runE2E } from "./e2e";
import { startLocalServer, type LocalServerHandle } from "./localServer";
import { runPerf } from "./perf";
import { runShellCheck } from "./shellCheck";
import { runC3Check } from "./c3Check";
import { checkDistFreshness, freshnessMessage } from "./distFreshness";
import { beginQuit, installTray, isQuitting, refreshTrayMenu, setTrayTooltip, showWindow } from "./tray";
import { createLanguageState } from "./language";
import { exitCodeAfterLock, lockDataFor, shouldFocusOnSecondInstance } from "./singleInstance";
import { createDeepLinkRouter, DEEP_LINK_SCHEME, IPC_DEEP_LINK_AVAILABLE, IPC_DEEP_LINK_DRAIN } from "./deepLink";
import { getAutoStart, installWakeSignals, notifications, notify, setAutoStart, setBadge } from "./shellCaps";
import { parseNotifyScope } from "./notifyRegistry";
import { isExternallyOpenable, openExternal, saveFile } from "./fileCaps";
import { MIN_SIZE, restoreWindowState, saveWindowState } from "./windowState";
import { createSqliteStore, type SqliteStore } from "./sqliteStore";
import { IPC_STORE, isStoreMethod } from "../shared/storeIpc";

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
/** `--shell-check`：托盘/退出闸/窗口状态的生命周期自检（见 shellCheck.ts）。 */
const shellMode = process.argv.includes("--shell-check");
/** `--c3-check`：C3 取数分流的行为级验收——数 window_req 帧（见 c3Check.ts）。同样不显窗口。 */
const c3Mode = process.argv.includes("--c3-check");
/** 任一自检模式。**加新模式只改这一处**——下面三个地方（不显窗口 / 跑自检 / 抢锁时报身份）都读它。 */
const anySelfCheck = smokeMode || e2eMode || perfMode || shellMode || c3Mode;

// 单实例锁（见 singleInstance.ts 顶部：两个进程同写一份 messages.db）。
// **必须在 whenReady 之前抢**：拿不到锁的进程什么都不该建——托盘、SQLite、本地同源层一个都不许碰。
// 用 `app.exit` 而不是 `app.quit`：quit 会先走完 ready 再退，那段时间里下面的 whenReady 回调照样会跑。
const lockData = lockDataFor(process.argv, anySelfCheck);
const lockExit = exitCodeAfterLock(lockData, app.requestSingleInstanceLock(lockData));
if (lockExit !== null) {
  if (lockData.kind === "self-check") {
    process.stderr.write("[im-desktop] 已有一个 IM Desktop 在运行（同一个 userData）——先退出它再跑自检\n");
  }
  app.exit(lockExit);
}

/** 主窗口。深链与 second-instance 都要够到它，而那两条路的事件可能早于 whenReady 里的局部变量存在。 */
let mainWin: BrowserWindow | null = null;
const liveMainWin = (): BrowserWindow | null => (mainWin && !mainWin.isDestroyed() ? mainWin : null);

// 深链（见 deepLink.ts 顶部：只收邀请码、排队等页面来取）。
const deepLinks = createDeepLinkRouter(
  () => { liveMainWin()?.webContents.send(IPC_DEEP_LINK_AVAILABLE); },
  (why) => { process.stderr.write(`[im-desktop] 丢弃深链：${why}\n`); },
);
if (lockExit === null) {
  // **必须在模块顶层装**：macOS 冷启动时 open-url 早于 ready 到，装在 whenReady 里就漏掉了那一条。
  app.on("open-url", (e, url) => {
    e.preventDefault();
    if (!deepLinks.acceptUrl(url) || anySelfCheck) return;   // 自检不把隐藏窗口弹出来
    const w = liveMainWin();
    if (w) showWindow(w);
  });
  deepLinks.acceptArgv(process.argv);   // Windows / Linux 冷启动：链接在启动参数里
  // 只在打包版登记：dev 下登记的是 Electron 本体，等于把整台机器的 imdesktop:// 交给了一个开发二进制。
  // macOS 另要 Info.plist 声明（electron-builder.yml 的 protocols），这一行在 mac 上是补登记。
  if (app.isPackaged && !app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)) {
    process.stderr.write(`[im-desktop] 登记 ${DEEP_LINK_SCHEME}:// 失败，深链点不进来\n`);
  }
}

// 全局快捷键（**默认关**，设置里开；见 globalShortcutCap.ts）。要等 ready 才能注册，这里只建。
// 偏好落 device.json（跟窗口状态同一份），这样登录前、页面还没起来时就能按偏好注册上。
// 界面语言（页面之外的文案：托盘菜单 / 启动失败对话框）。页面经 im:set-language 推偏好，这里落盘。
const language = createLanguageState({
  file: join(app.getPath("userData"), "lang.json"),
  systemLangs: () => app.getPreferredSystemLanguages(),
  onChange: () => refreshTrayMenu(),
});

const shortcut = createGlobalShortcut({
  registry: globalShortcut,
  platform: process.platform,
  load: () => readLocalState().globalShortcut === true,
  save: (on) => { writeLocalState({ globalShortcut: on }); },
  onPress: () => {
    const w = liveMainWin();
    if (!w) return;
    if (toggleActionFor(w.isVisible(), w.isFocused()) === "hide") w.hide();
    else showWindow(w);
  },
});

function createWindow(): BrowserWindow {
  // 位置与大小从上次记的恢复；整块落在屏幕外时只留尺寸、位置交给系统（见 windowState.ts）。
  const st = restoreWindowState();
  const win = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: st.x,
    y: st.y,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
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

  // `window.open` 的去向。**不设这个的后果**：Electron 默认允许开子窗口且**继承 webPreferences**
  // ——包括那个 preload，于是任意 `window.open` 都会造出第二个挂着完整桥的窗口。
  // 三条去向都是刻意的：
  //   · http(s) → 交系统浏览器（与 openExternal 同一条路，别在应用里再开一个浏览器）
  //   · blob:/data: → 允许开窗，但**不带 preload、不带 node**：它是本应用下载下来的媒体预览
  //     （useMediaDownload 的预览分支对已下载文件传的就是 blob:），内容是我们自己的，但没有理由带桥
  //   · 其余一律拒
  //
  // ⚠️ 下面那个 `preload: undefined` **在 Electron 44 上是 no-op**（2026-09-10 实测：
  // `window.open` 造出的子窗本来就不继承 preload，删掉整段覆盖子窗照样没有桥）。留着是表明意图，
  // 别把它当护栏——真正守住这条的是 `--shell-check` 里的 `checkChildWindowBridge`，
  // 它做过双向变异验证。改这一段前先读 `bridgeIsolation.ts` 顶部那段结论。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternallyOpenable(url)) { openExternal(url); return { action: "deny" }; }
    if (url.startsWith("blob:") || url.startsWith("data:")) {
      return { action: "allow", overrideBrowserWindowOptions: { webPreferences: { preload: undefined, nodeIntegration: false, contextIsolation: true, sandbox: true } } };
    }
    process.stderr.write(`[im-desktop] 拒绝 window.open：${url.slice(0, 80)}\n`);
    return { action: "deny" };
  });
  win.once("ready-to-show", () => {
    if (anySelfCheck) return;
    if (st.maximized) win.maximize();
    win.show();
  });
  // 记窗口几何。`resize`/`move` 触发很密，节流着写，别把 device.json 写成热点。
  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 400);
  };
  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  // 关闭前立刻存一次：节流的那次可能还没落地。收进托盘也算一次「用户摆完了」。
  win.on("close", () => { if (saveTimer) clearTimeout(saveTimer); saveWindowState(win); });
  // 窗口回到前台 = 手机上的「打开 App」：已弹的通知全部收掉（iOS sceneDidBecomeActive / Android RESUMED 同口径）。
  win.on("focus", () => { notifications.clear({}); });
  return win;
}

let localServer: LocalServerHandle | null = null;
/** 本地消息库（D4-3b）。打不开时保持 null，渲染侧会整体回落 IndexedDB。 */
let store: SqliteStore | null = null;
/** 唤醒信号的拆除函数（D4-4）。 */
let stopWakeSignals: (() => void) | null = null;

/**
 * 桥的 IPC 处理端。
 *
 * **`setBadge`/`notify` 走 `handle`（异步），不走 `sendSync`**：sendSync 会阻塞渲染进程等主
 * 进程回复，而主进程在所有自检模式下都在 `await webContents.executeJavaScript(...)` 等渲染进程
 * → 互等死锁。2026-09-08 实测到：D4-2 接上后 `--e2e` 卡在「会话列表」永不出现，
 * 而浏览器版一切正常——因为浏览器里压根没有这条通道。
 * **四个都走 `handle`**：开机自启那两个原先用 `on`/sendSync，理由是「设置页是用户点出来的」——
 * 但 `getAutoStart` 实际在页面挂载时就会被调用，那个理由不成立（/code-review 2026-09-08）。
 */
function installBridgeIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle("im:set-badge", (_e, count: unknown) =>
    setBadge(typeof count === "number" ? count : 0, setTrayTooltip));
  ipcMain.handle("im:notify", (_e, p: unknown) => {
    const q = (p ?? {}) as { title?: unknown; body?: unknown; convId?: unknown; convSeq?: unknown; icon?: unknown };
    return notify(getWin(), {
      title: String(q.title ?? ""),
      body: String(q.body ?? ""),
      convId: typeof q.convId === "string" ? q.convId : undefined,
      convSeq: typeof q.convSeq === "number" ? q.convSeq : undefined,
      icon: typeof q.icon === "string" ? q.icon : undefined,
    });
  });
  // 收回已弹的通知（撤回 / 别处已读）。参数形状不对就什么都不收（parseNotifyScope 的约定）。
  ipcMain.handle("im:clear-notifications", (_e, p: unknown) => {
    const scope = parseNotifyScope(p);
    return scope ? notifications.clear(scope) : 0;
  });
  // 深链：页面订阅时先取一次、之后每收到「有新链接」再取。取走即清（deepLink.ts）。
  ipcMain.handle(IPC_DEEP_LINK_DRAIN, () => deepLinks.drain());
  // 全局快捷键：与开机自启同口径，set 返回**设完之后的真实状态**（被占用时 enabled=false、taken=true）。
  ipcMain.handle("im:get-global-shortcut", () => shortcut.state());
  ipcMain.handle("im:set-global-shortcut", (_e, on: unknown) => shortcut.set(on === true));
  ipcMain.handle("im:set-language", (_e, pref: unknown) => { language.set(pref); });
  ipcMain.handle("im:get-auto-start", () => getAutoStart());
  ipcMain.handle("im:set-auto-start", (_e, on: unknown) => setAutoStart(on === true));

  // 另存：异步（要弹保存对话框）。返回值只给日志/自检用，契约那侧是 Promise<void>。
  ipcMain.handle("im:save-file", async (_e, p: unknown) => {
    const q = (p ?? {}) as { name?: unknown; url?: unknown; bytes?: unknown };
    return saveFile(getWin(), {
      name: typeof q.name === "string" ? q.name : "download",
      url: typeof q.url === "string" ? q.url : undefined,
      bytes: q.bytes instanceof Uint8Array || q.bytes instanceof ArrayBuffer ? q.bytes : undefined,
    });
  });

  // 打开外链：**`on` 不是 `handle`**。契约要求 `openExternal` 是同步 fire-and-forget
  // （脱离用户手势的调用栈就会被弹窗拦截器吃掉，见 types.ts），所以桥那侧用 `send`，
  // 这边就得用 `on` 接。用 `handle` 的话 preload 只能 `invoke`，那是个 Promise，语义就变了。
  ipcMain.on("im:open-external", (_e, url: unknown) => {
    openExternal(typeof url === "string" ? url : "");
  });
}

/**
 * 本地消息库通道（D4-3b）：渲染进程的 16 个方法都从这一发 invoke 进来。
 *
 * **必须走白名单**（`isStoreMethod`），不能直接 `store[method]`——那等于把渲染进程的任意
 * 属性访问转发给主进程对象，`close` 之类不该暴露的东西也就跟着能调了。
 *
 * **绝不把异常抛回渲染进程**：契约那条「失败只降级不抛」在跨进程之后更要紧——
 * ipcRenderer.invoke 的 reject 会变成页面里的 unhandled rejection，而持久化只是增强，
 * 不该让收发主流程跟着断。实现内部已经逐个 guard 过，这里是最后一道。
 */
function installStoreIpc(getStore: () => SqliteStore | null): void {
  ipcMain.handle(IPC_STORE, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { method?: unknown; args?: unknown };
    const store = getStore();
    if (!store || !isStoreMethod(p.method)) {
      process.stderr.write(`[im-desktop] store 通道拒绝：method=${String(p.method)} store=${!!store}\n`);
      return undefined;
    }
    const args = Array.isArray(p.args) ? p.args : [];
    try {
      return await (store[p.method] as (...a: unknown[]) => Promise<unknown>)(...args);
    } catch (e) {
      process.stderr.write(`[im-desktop] store ${p.method} 抛了：${e instanceof Error ? e.message : String(e)}\n`);
      return undefined;
    }
  });
}

/** 启动失败时把话说出来。**没有这个的后果是「窗口永不出现且零报错」**——
 *  show:false + 只在 ready-to-show 才 show()，一旦 whenReady 链里抛了，用户看到的是
 *  「点了图标什么也没发生」。最常见的触发是仓库根没跑 npm run dev（/code-review 抓到）。 */
function fatal(stage: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`[im-desktop] 启动失败（${stage}）：${msg}\n`);
  if (!app.isPackaged && msg.includes("ERR_CONNECTION_REFUSED")) {
    process.stderr.write("[im-desktop]   dev 模式要先在仓库根跑 `npm run dev`（Vite :5173）\n");
  }
  dialog.showErrorBox(language.t("desktop.startup_failed"), `${stage}：${msg}`);
  app.exit(1);
}

app.whenReady().then(async () => {
  if (lockExit !== null) return;   // 没拿到锁：app.exit 已发出，别在退出途中建任何东西
  const win = createWindow();
  mainWin = win;
  // 用户又点了一次图标 / 从命令行又起了一个 / Windows 上点了一条深链：那个进程已被锁拒掉，
  // 它的参数（可能带着深链）转到这边。窗口通常是被托盘收起（hide）而不是销毁，所以 show 就够。
  // **深链先收、再判要不要叫窗口**：自检递来的深链也要走完整条路（e2e 靠这个验 argv 那条），只是不弹窗。
  app.on("second-instance", (_e, argv, _cwd, data) => {
    deepLinks.acceptArgv(argv);
    const w = liveMainWin();
    if (w && shouldFocusOnSecondInstance(data)) showWindow(w);
  });
  // **必须无条件装，且早于页面加载**：页面一渲染就会调 platform().setBadge()，
  // 而它走的是 ipcRenderer.sendSync——处理端不在，轻则拿到 undefined、重则卡住渲染进程。
  // 原先只在正常模式装，等于所有自检模式下页面都在对着空通道喊（自检本身反而验不到这条）。
  installBridgeIpc(() => (win.isDestroyed() ? null : win));
  // 本地库落 userData（跟着用户配置走，卸载重装前一直是同一份）。
  // **既有 IndexedDB 数据不迁移**（§7.6.3 的取舍）：换过去等于本地缓存清空一次、
  // 消息从服务端重新同步——不丢数据，但「离线冷启动可浏览」会断一次。
  // 打不开就让 store 保持 null，通道会拒绝、渲染侧整体回落 IndexedDB（它在 Electron 里照样能跑）。
  try {
    store = createSqliteStore(join(app.getPath("userData"), "messages.db"));
  } catch (e) {
    process.stderr.write(`[im-desktop] 本地库打不开，回落 IndexedDB：${e instanceof Error ? e.message : String(e)}\n`);
    store = null;
  }
  installStoreIpc(() => store);
  // 桌面独有的唤醒源（睡眠唤醒 / 解锁 / 窗口聚焦）。web 那两个信号仍在页面里订阅着，
  // 这层是**叠加**——见 platform/desktop.ts 的 subscribeWake。
  stopWakeSignals = installWakeSignals(() => (win.isDestroyed() ? null : win));
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

  if (anySelfCheck) {
    const say = (s: string): void => { process.stdout.write(`${s}\n`); };
    // **对着旧产物跑出来的绿是假的**。只在「未打包 + 走本地同源层」时判——
    // dev 模式加载 :5173 是实时源码，打包版的 dist 就是包里那份，都不适用。
    if (!app.isPackaged && localServer) {
      const f = checkDistFreshness(distDir(), join(__dirname, "../../..", "src"));
      if (f.stale) {
        say(`[stale] ✗ ${freshnessMessage(f)}`);
        app.exit(7);
        return;
      }
    }
    const code = c3Mode ? await runC3Check(win, load, say)
      : shellMode ? await runShellCheck(win, load, say)
      : perfMode ? await runPerf(win, load, say)
      : e2eMode ? await runE2E(win, load, say, store)
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

  // 托盘 + 「关闭 = 收起」。自检模式不装：它会在菜单栏留个图标，而自检紧接着就 exit。
  installTray(win, (key) => language.t(key));
  // 按偏好注册全局快捷键。只在正常启动走到这里——自检模式在上面已经 return，不许替用户抢键。
  shortcut.restore();

  app.on("activate", () => {
    // macOS：Dock 图标被点时把窗口召回来。装了托盘之后窗口是被 hide 的（不是销毁），
    // 所以先试 show；真没有窗口了才新建。
    const [first] = BrowserWindow.getAllWindows();
    if (first) { first.show(); first.focus(); return; }
    mainWin = createWindow();          // 深链与 second-instance 要够到的是这个新窗口
    mainWin.loadURL(target);           // **必须用同一个 target**，写死 DEV_URL 会让打包版打到不存在的 :5173
  });
});

// 本地服务是常驻资源，退出前停掉。
// ⚠️ **`server.close()` 只停止接新连接，拆不掉已建立的 WS 长连接**（/code-review 指出：
// 原注释说它能防端口/fd 累积，那是不对的——真正回收靠的是进程退出，且 smoke/e2e/perf 走
// `app.exit()` 压根不触发 will-quit）。D4 若加「关闭=最小化到托盘」而需要在不退进程的前提下
// 重建服务，这里必须改成记下活连接并逐个 destroy。
app.on("will-quit", () => {
  localServer?.close(); localServer = null;
  store?.close(); store = null;
  stopWakeSignals?.(); stopWakeSignals = null;
  shortcut.dispose();
});

// 装了托盘之后，关窗只是 hide，窗口不会被销毁，所以 window-all-closed 正常情况下压根不触发。
// 只有「托盘 → 退出」那条路才会走到这里（那时 quitting 已置上）。保留这个兜底是为了
// 万一窗口真被销毁（崩溃/系统强制）时，非 macOS 平台不要留一个只有托盘的僵尸进程。
app.on("window-all-closed", () => {
  if (isQuitting() || process.platform !== "darwin") app.quit();
});

// 菜单栏「退出」/ Cmd+Q / 系统关机：这些不走托盘菜单，也要把闸置上，否则 close 事件
// 会被托盘那段 preventDefault 收进托盘，用户按 Cmd+Q 会发现退不掉。
app.on("before-quit", () => beginQuit());
