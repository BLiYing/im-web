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
//   ④ **进会话 / ↓ 到底两个动作的耗时**（B0 基线要的三个动作里的后两个，
//      OFFLINE_BACKLOG_DESIGN §5）。目标会话用 `IM_PERF_CONV` 指定，默认不测——
//      因为它只在**积压数据集**上才有意义（空会话量出来的数字没有参照价值）。
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

/** 要测「进会话 / ↓」的目标会话名。空 = 跳过这两项（见文件头 ④）。 */
const PERF_CONV = process.env.IM_PERF_CONV || "";

/** 轮询一个返回布尔的表达式，返回耗时 ms；超时返回 -1。 */
async function timeUntil(win: BrowserWindow, expr: string, timeoutMs = 30_000): Promise<number> {
  const start = Date.now();
  const deadline = start + timeoutMs;
  for (;;) {
    if ((await win.webContents.executeJavaScript(`!!(${expr})`)) as boolean) return Date.now() - start;
    if (Date.now() > deadline) return -1;
    await wait(60);   // 比 e2e 的 250ms 密：这里量的是耗时，轮询间隔直接进误差
  }
}

/**
 * 测「进会话」与「↓ 到底」。
 *
 * **为什么单独量这两个**：G1 说「每次操作的工作量只与屏幕大小有关，与积压条数无关」，
 * 而这两个正是最容易被积压拖垮的动作——进会话要定位未读位置、↓ 要跳到最新。
 * 冷启动那条测不出它们：会话列表是从本地库秒显的，压根不碰单个会话的消息。
 *
 * ⚠️ 轮询间隔 60ms 直接算进误差，所以这些数字**只在同一台机器上跨版本对比才有意义**，
 * 不要拿去和别人的机器比。
 */
async function measureConvActions(win: BrowserWindow, say: (s: string) => void): Promise<boolean> {
  const open = `(() => {
    const rows = [...document.querySelectorAll('.convitem')];
    const hit = rows.find((e) => (e.querySelector('.convpeer')?.textContent || '').includes(${JSON.stringify(PERF_CONV)}));
    if (!hit) return false;
    hit.click();
    return true;
  })()`;
  if (!((await win.webContents.executeJavaScript(open)) as boolean)) {
    say(`[perf] ✗ 找不到名字含「${PERF_CONV}」的会话——IM_PERF_CONV 写对了吗？`);
    return false;
  }
  // 进会话 = 从点下去到消息真的渲染出来（不是容器出现就算——空容器骗不了人但骗得了断言）。
  const tEnter = await timeUntil(win, `document.querySelectorAll('.msgs .msgrow, .msgs .msgitem, .msgs [data-seq]').length > 0`);
  if (tEnter < 0) {
    say("[perf] ✗ 进会话超时：30s 内没有消息渲染出来");
    return false;
  }
  say(`[perf] 动作 · 进会话（首屏消息可见）  ${tEnter} ms`);

  // ↓ 到底：先滚上去让按钮出现，再点它，量到「滚动停在底部」为止。
  await win.webContents.executeJavaScript(`(() => { const el = document.querySelector('.msgs'); if (el) el.scrollTop = 0; })()`);
  const shown = await timeUntil(win, `document.querySelector('.jump-btn')`, 5_000);
  if (shown < 0) {
    say("[perf] – ↓ 按钮没出现（会话太短？），跳过这一项");
    return true;
  }
  await win.webContents.executeJavaScript(`document.querySelector('.jump-btn').click()`);
  const tJump = await timeUntil(win, `(() => { const el = document.querySelector('.msgs'); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 40; })()`);
  if (tJump < 0) {
    say("[perf] ✗ ↓ 到底超时：30s 内没停在底部");
    return false;
  }
  say(`[perf] 动作 · ↓ 到底                 ${tJump} ms`);
  return true;
}

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
  if (tUsable < 0) {
    // **不能继续往下量**（/code-review 抓到）：会话列表没出来说明停在登录页，
    // 这时采到的内存是一个登录页的内存——本次 D3 就先量错了三轮（323 MB 而非 486 MB），
    // 而当时它照样 return 0，人和 CI 都会把它当有效数据。
    say("[perf] ✗ 会话列表未出现——多半停在登录页，此时的内存不代表应用空载。");
    say("[perf]   perf 模式不自动登录：先跑一次 `npm run e2e` 建立会话，再跑 perf。");
    return 4;
  }
  say(`[perf] 冷启动 · 会话列表可见        ${tUsable} ms`);

  // B0 的后两个动作。没给 IM_PERF_CONV 就跳过——空会话上的数字没有参照价值。
  if (PERF_CONV) {
    if (!(await measureConvActions(win, say))) return 5;
  } else {
    say("[perf] – 未设 IM_PERF_CONV，跳过「进会话 / ↓」两项（B0 基线需要它们）");
  }

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
