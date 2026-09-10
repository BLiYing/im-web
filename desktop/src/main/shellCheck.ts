// `--shell-check`：外壳生命周期自检（D4-1）。
//
// 托盘那段最容易做错的不是图标，是**闸**：关窗要收进托盘（窗口不能被销毁，否则下次
// 「显示主窗口」没有窗口可显），而托盘菜单「退出」/ Cmd+Q 又必须真的退得掉
// （少一个 isQuitting 闸，app.quit() 会再次触发 close、又被 preventDefault 收回去，
// 用户按 Cmd+Q 会发现退不掉）。这两条互相拉扯，正是那种「手点一次好像没问题、
// 换个入口就锁死」的逻辑，所以在主进程里程序化验一遍，不靠人盯屏幕。
import { BrowserWindow } from "electron";
import { beginQuit, installTray } from "./tray";
import { readLocalState } from "./identity";
import { getAutoStart, notify, setBadge } from "./shellCaps";
import { setTrayTooltip } from "./tray";
import { checkChildWindowBridge } from "./bridgeIsolation";

/** 轮询到条件成立为止，或超时。**「该发生的事」用它**——成功时立刻返回，不为等待付固定成本。 */
async function waitUntil(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pred()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** 「不该发生的事」只能等一段时间再看。**这个等待必须给得宽**——
 * 第一版用了 50ms，窗口销毁还没落地，于是「关窗被销毁」这个故障被判成了通过
 * （2026-09-08 变异测试抓到：去掉 preventDefault 后检查照样全绿）。
 * 又不能只把数字调大了事：固定 sleep 换台慢机器还会翻。所以这里等的是**事件**，
 * 时间只是上限——`closed` 一旦触发立刻判负，没触发才等满。 */
const NOT_HAPPEN_MS = 1500;

export async function runShellCheck(
  win: BrowserWindow,
  /** 页面加载的 promise。⓪ 要在渲染进程里 `window.open`，没文档就调不动。 */
  load: Promise<void>,
  say: (s: string) => void,
): Promise<number> {
  const fail: string[] = [];

  try {
    installTray(win);
    say("[shell] ✓ 托盘装上了（图标资源可读）");
  } catch (e) {
    say(`[shell] ✗ 装托盘失败：${String(e)}`);
    say("[shell]   多半是图标路径不对——打包版走 process.resourcesPath，要 electron-builder 的 extraResources 带上");
    return 2;
  }

  // ⓪ blob: 子窗不许挂桥。**必须排在 ①② 前面**——那两步会把窗口关掉/销毁，
  //    之后就没有渲染进程可以 `window.open` 了。
  try {
    await load;
    for (const r of await checkChildWindowBridge(win)) {
      if (r.ok) say(`[shell] ✓ blob: 子窗没有桥（${r.name}）：${r.detail}`);
      else fail.push(`blob: 子窗（${r.name}）${r.detail}——它能直接调 localStore 读写本地消息库；见 index.ts 的 setWindowOpenHandler`);
    }
  } catch (e) {
    fail.push(`blob: 子窗桥隔离没验成：${String(e)}`);
  }

  // ① 未置退出闸时关窗：必须**收起而不是销毁**。销毁了下次「显示主窗口」就没窗口可显。
  //    这是「不该发生的事」，所以监听 closed 事件 + 给一段宽裕的上限，而不是睡一小会儿看一眼。
  let closedEarly = false;
  win.once("closed", () => { closedEarly = true; });
  win.close();
  await waitUntil(() => closedEarly, NOT_HAPPEN_MS);
  if (closedEarly || win.isDestroyed()) {
    fail.push("未点退出就关窗，窗口却被销毁了——托盘的 preventDefault 没生效，下次「显示主窗口」会没有窗口可显");
  } else {
    say("[shell] ✓ 关窗 = 收起（窗口未被销毁）");
  }

  // ② 置了退出闸再关：必须真的销毁。否则 Cmd+Q / 托盘退出会锁死。
  //    这是「该发生的事」，轮询到发生为止，成功时立刻返回。
  if (!win.isDestroyed()) {
    beginQuit();
    win.close();
    const gone = await waitUntil(() => win.isDestroyed(), 3000);
    if (!gone) fail.push("已点退出仍关不掉窗口——isQuitting 闸没起作用，Cmd+Q 会锁死");
    else say("[shell] ✓ 退出闸置上后，关窗真的销毁窗口");
  }

  // ③ D4-2 的宿主能力：角标 / 通知 / 自启。**都要看真实返回值**——
  //    这三个的契约是「真的做到了吗」，谎报成功会让页面跳过应用内兜底（/code-review 上一轮的教训）。
  const badgeOk = setBadge(3, setTrayTooltip);
  setBadge(0, setTrayTooltip);          // 立刻清掉，别把自检的数字留在 Dock 上
  if (process.platform === "darwin" && !badgeOk) {
    fail.push("macOS 上 setBadgeCount 返回 false——Dock 角标没设上");
  } else {
    say(`[shell] ✓ 角标 setBadge=${badgeOk}（Windows 无 Dock 角标，false 是正常的）`);
  }

  // 这一步会真的弹一条系统通知。返回 true 只代表「交给系统了」——用户若在系统设置里
  // 关了本应用的通知权限，show() 不报错也不显示，Electron 查不到，这条不确定性消不掉。
  const notifyOk = notify(win.isDestroyed() ? null : win, "IM Desktop 自检", "这是一条自检通知，可忽略", undefined);
  if (!notifyOk) fail.push("Notification 不可用或 show() 抛了");
  else say("[shell] ✓ 系统通知已交给系统（会真的弹一条，可忽略；能否显示还取决于系统权限）");

  say(`[shell] · 开机自启当前状态 = ${getAutoStart()}（自检不改它）`);

  // ④ 窗口几何应当已被记下（close 时会强制存一次）。
  const st = readLocalState().windowState as { bounds?: { width?: number } } | undefined;
  if (!st?.bounds?.width) fail.push("窗口状态没落盘——下次启动尺寸会跳回默认");
  else say(`[shell] ✓ 窗口状态已落盘（${st.bounds.width}px 宽）`);

  if (fail.length) {
    for (const f of fail) say(`[shell] ✗ ${f}`);
    return 1;
  }
  say("[shell] ✓ 外壳生命周期自检通过");
  return 0;
}
