// 单实例锁（D4 收尾）。
//
// **这不是体验项，是数据正确性**：两个进程共用同一个 userData，也就同时打开同一份
// `messages.db`（主进程 SQLite）与同一个 `device.json`（deviceId / 窗口状态 / 本地端口），
// 还各挂一个托盘图标。SQLite 在 WAL 下扛得住并发写，但两个页面各自维护游标与区间，谁后写谁赢——
// 表现是「消息偶尔重新同步一遍」这种不像 bug 的样子。本地同源层还会抢端口：第二个进程拿不到
// 记住的端口就退回临时端口 → origin 变 → localStorage 全丢（DESKTOP_DESIGN §7.5 那个坑）。
//
// ⚠️ 锁按 userData 路径算：dev（`electron .`，userData 目录名取 package.json 的 name）与打包版
// （productName）是**两把锁**，同时开着互不影响。这是 Electron 的行为，不是本文件的疏漏。
import { app } from "electron";
import { spawn } from "node:child_process";

/** 第二个实例随锁请求递给主实例的数据。`kind` 让主实例分得清「用户又点了一次图标」和「自检」。 */
export type SecondInstanceData =
  | { kind: "launch" }
  | { kind: "probe" }
  | { kind: "self-check" };

/** `--shell-check` 用它起一个探针进程：只抢锁、不建窗口，用退出码报告结果。 */
export const PROBE_FLAG = "--single-instance-probe";
/** 探针被拒 = 锁生效。 */
export const PROBE_EXIT_DENIED = 42;
/** 探针拿到了锁 = 锁没生效（两个进程会同时写 messages.db）。 */
export const PROBE_EXIT_ACQUIRED = 43;
/** 自检模式撞上了正在运行的实例。 */
export const EXIT_ALREADY_RUNNING = 11;

/** 由启动参数决定本进程抢锁时递什么。探针优先：它可能与自检参数一起出现。 */
export function lockDataFor(argv: readonly string[], isSelfCheck: boolean): SecondInstanceData {
  if (argv.includes(PROBE_FLAG)) return { kind: "probe" };
  return isSelfCheck ? { kind: "self-check" } : { kind: "launch" };
}

/**
 * 抢锁之后本进程该不该退、用什么退出码。`null` = 继续正常启动。
 *
 * - 探针：无论抢没抢到都退，用退出码报告（它的全部意义就是这个码）。
 * - 自检被拒：**必须非零退出**。静默退掉的话 `npm run e2e` 会 exit 0，
 *   看起来像通过了——本仓 §4.6.1~§4.6.4 记的四个 fail-open 都是这个形状。
 * - 正常启动被拒：退 0。用户只是又点了一次图标，主实例会把窗口叫出来，这里没有错。
 */
export function exitCodeAfterLock(data: SecondInstanceData, gotLock: boolean): number | null {
  if (data.kind === "probe") return gotLock ? PROBE_EXIT_ACQUIRED : PROBE_EXIT_DENIED;
  if (gotLock) return null;
  return data.kind === "self-check" ? EXIT_ALREADY_RUNNING : 0;
}

/**
 * 主实例收到 `second-instance` 时要不要把窗口叫出来。
 *
 * 探针与自检不许打扰用户正在用的窗口。**认不出来的数据按「叫出来」处理**：老版本外壳不带
 * additionalData，那种情况最可能就是用户点了图标——宁可多弹一次窗口，也不要让用户以为应用没反应。
 */
export function shouldFocusOnSecondInstance(data: unknown): boolean {
  if (!data || typeof data !== "object") return true;
  const kind = (data as { kind?: unknown }).kind;
  return kind !== "probe" && kind !== "self-check";
}

/** 真起一个探针进程，验「第二个实例被拒 + 主实例收到了它」。**只给 `--shell-check` 用。**
 *
 *  为什么要真起进程而不是调一下 `app.hasSingleInstanceLock()`：那只能证明「本进程拿着锁」，
 *  证明不了「别的进程会被拒」——锁的全部价值在后半句。 */
export async function probeSecondInstance(timeoutMs = 20_000): Promise<{ ok: boolean; detail: string }> {
  let delivered = false;
  const onSecond = (_e: Electron.Event, _argv: string[], _cwd: string, data: unknown): void => {
    if ((data as { kind?: unknown } | null)?.kind === "probe") delivered = true;
  };
  app.on("second-instance", onSecond);
  try {
    const code = await runProbeProcess(timeoutMs);
    if (code === PROBE_EXIT_ACQUIRED) {
      return { ok: false, detail: "第二个实例拿到了锁——requestSingleInstanceLock 没生效，两个进程会同时写 messages.db" };
    }
    if (code !== PROBE_EXIT_DENIED) {
      const why = code === null ? "（超时被杀：多半没走探针分支、真的起了一个应用）" : "";
      return { ok: false, detail: `探针退出码 ${String(code)}，期望 ${PROBE_EXIT_DENIED}${why}` };
    }
    // 被拒之后主实例那侧的事件是异步到的，给一段上限等它。
    const deadline = Date.now() + 3000;
    while (!delivered && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    if (!delivered) {
      return { ok: false, detail: "探针被拒了，但主实例没收到带 kind=probe 的 second-instance——用户再点图标时窗口不会出来" };
    }
    return { ok: true, detail: `第二个实例被拒（退出码 ${PROBE_EXIT_DENIED}），主实例收到了它的 second-instance` };
  } finally {
    app.off("second-instance", onSecond);
  }
}

/** 起探针并等它退出；超时杀掉返回 null，起不来返回 -1。 */
function runProbeProcess(timeoutMs: number): Promise<number | null> {
  // 未打包时 execPath 是 Electron 本体，要把应用目录作为第一个参数；打包版 execPath 就是应用。
  const args = app.isPackaged ? [PROBE_FLAG] : [app.getAppPath(), PROBE_FLAG];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); resolve(null); }, timeoutMs);
    child.on("exit", (code) => { clearTimeout(timer); resolve(code); });
    child.on("error", () => { clearTimeout(timer); resolve(-1); });
  });
}
