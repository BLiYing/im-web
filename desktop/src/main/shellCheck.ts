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

export async function runShellCheck(win: BrowserWindow, say: (s: string) => void): Promise<number> {
  const fail: string[] = [];

  try {
    installTray(win);
    say("[shell] ✓ 托盘装上了（图标资源可读）");
  } catch (e) {
    say(`[shell] ✗ 装托盘失败：${String(e)}`);
    say("[shell]   多半是图标路径不对——打包版走 process.resourcesPath，要 electron-builder 的 extraResources 带上");
    return 2;
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

  // ③ 窗口几何应当已被记下（close 时会强制存一次）。
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
