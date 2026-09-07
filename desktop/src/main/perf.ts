// `--perf`：D3 性能实测。**当初 DESKTOP_DESIGN §4.3 里那张量级表大半是「预期」不是实测**
// （只有 Telegram 44 MB 与 Claude 桌面端 ~1.2 GB 是量过的），D3 的任务就是让预期接受检验，
// 并据此定稿壳选型（§10）。
//
// 做成可重跑的模式而不是一次性 `ps`，理由和 smoke/e2e 一样：一次性的数字没法在换了写法、
// 换了 Electron 版本之后回头对账，而对账才是这件事的意义。
//
// 测三样：
//   ① 冷启动——从**进程创建**（不是 app ready）到会话列表出现在屏幕上。用户感知的是这一段。
//   ② 空载常驻内存——静置后按 Electron 自己的 app.getAppMetrics() 分进程记，比外部 ps 准
//      （能分清主进程/渲染/GPU/工具进程，也不会把别的 Electron 应用混进来）。
//   ③ 采样多次取最大——内存会在 GC 前后跳，单次采样容易骗自己。
import { app, BrowserWindow } from "electron";

/** 静置多久再采样。太短会量到启动期的峰值，太长这个模式就没人愿意跑。 */
const IDLE_MS = 12_000;
const SAMPLES = 3;
const SAMPLE_GAP_MS = 1_500;

interface ProcRow { type: string; pid: number; mb: number }

function sample(): ProcRow[] {
  return app.getAppMetrics().map((m) => ({
    type: m.type,
    pid: m.pid,
    // workingSetSize 单位是 KB（Electron 文档），换成 MB 便于和 ps 的 RSS 对读。
    mb: Math.round((m.memory.workingSetSize / 1024) * 10) / 10,
  }));
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runPerf(win: BrowserWindow, load: Promise<void>, say: (s: string) => void): Promise<number> {
  const created = process.getCreationTime();          // 进程创建时刻（epoch ms），拿不到时为 null
  const t0 = created ?? Date.now();
  say(`[perf] 进程创建 → 现在 ${Date.now() - t0} ms（app.whenReady 之后）`);

  try {
    await load;
  } catch (e) {
    say(`[perf] ✗ 页面加载失败：${String(e)}`);
    return 2;
  }
  const tLoaded = Date.now() - t0;
  say(`[perf] 冷启动 · 页面 load 完成      ${tLoaded} ms`);

  // 会话列表出现 = 用户觉得「能用了」的那一刻。会话是从本地库先秒显的，所以这一段不含网络往返。
  let tUsable = -1;
  const deadline = Date.now() + 20_000;
  for (;;) {
    const ok = (await win.webContents.executeJavaScript(
      `document.querySelectorAll('.convitem').length > 0`,
    )) as boolean;
    if (ok) { tUsable = Date.now() - t0; break; }
    if (Date.now() > deadline) break;
    await wait(120);
  }
  say(tUsable > 0
    ? `[perf] 冷启动 · 会话列表可见        ${tUsable} ms`
    : `[perf] 冷启动 · 会话列表可见        未出现（未登录？perf 模式不自动登录）`);

  say(`[perf] 静置 ${IDLE_MS / 1000}s 后采样 ${SAMPLES} 次…`);
  await wait(IDLE_MS);

  let best: ProcRow[] = [];
  let bestTotal = -1;
  for (let i = 0; i < SAMPLES; i++) {
    const rows = sample();
    const total = rows.reduce((s, r) => s + r.mb, 0);
    if (total > bestTotal) { bestTotal = total; best = rows; }
    if (i < SAMPLES - 1) await wait(SAMPLE_GAP_MS);
  }

  say("[perf] ── 空载常驻内存（取 3 次采样中的最大值，单位 MB）──");
  for (const r of best.sort((a, b) => b.mb - a.mb)) {
    say(`[perf]   ${r.type.padEnd(10)} pid=${String(r.pid).padEnd(6)} ${r.mb}`);
  }
  say(`[perf]   ${"合计".padEnd(10)} ${" ".repeat(11)} ${Math.round(bestTotal * 10) / 10}  （${best.length} 个进程）`);
  return 0;
}
