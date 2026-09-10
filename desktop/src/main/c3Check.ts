// `--c3-check`：C3「取数分流」的**行为级**验收——进会话 / 上滚到底，到底发了几个 `window_req`。
//
// 为什么非要有它：C3 的正确与否表现为「**该发的发了、不该发的没发**」，而 `window_req` 是
// WS 帧，SDK 不打日志，页面上也看不见——2026-09-10 那轮手工验证里这一项就是因此**被跳过**的
// （`DESKTOP_MANUAL_TEST` §5）。单测（`windowPlan.test.ts`）只钉判据函数，钉不住「判据有没有
// 真的接在进会话/上滚这两条路上」——C3 之前那半年正是「洞造出来了、填洞的人没到岗」。
//
// 帧从哪来：`webContents.debugger` 走 CDP 的 `Network.webSocketFrameSent`，**不改一行产品代码**
// 就能拿到原样的出站帧。别改 SDK 加计数器——那会让被测对象和测量手段变成同一份代码。
//
// 三条断言，对应 §5 那三行：
//   ① 第一次进会话：anchor **≥ 1**。`anchor<=0` 是协议里「取最新」的哨兵（PROTOCOL §6.11），
//      与 `sync_req` 的 `since=0`＝「从头」语义相反，客户端曾照搬旧写法 → 新成员进大群
//      一次清零十万未读（im-web fd2119d）。
//   ② 反复进同一个会话，请求次数**收敛到 0**（本地目录命中）。
//   ③ 一路上滚到会话开头：请求要**停下来**。
//      不停＝`has_before` 那道闸没接上，每次上滑都空跑一次注定回空页的请求
//      （对有可见下界的新成员恒真）。
//
// ⚠️ **①③ 与 ② 要跑在不同的会话上**，所以有 `IM_C3_PARTS`：
//   · ①③ 需要一个**大积压**会话（才谈得上锚点哨兵与上滚收敛）；
//   · ② 需要一个**读完了的**会话（`unread=0` ⇒ anchor=0 取最新 ⇒ 窗口固定在 `[head-page, head]`）。
// 大积压会话里 ② **永远不会收敛，而且这是对的**：进会话的窗口锚在读位点上
// （`[readSeq-contextBefore, readSeq+historyPage]`），每进一次「可见即读」就把读位点往前推，
// 窗口跟着右移、总探出已下载段一截。2026-09-10 实测 anchor 逐轮爬 9 → 25 → 49 → 81。
// 把这条写成「第二次进会话该零请求」就会把**正确行为判成 bug**（第一版就是这么写的）。
//
// ⚠️ **③ 目前是弱的，别把它的绿当成「has_before 那道闸验过了」**：压测群的成员是建群时就在的，
// 可见下界就是 conv_seq 1，于是 `App.tsx` 上滚分支里那个 `oldestRendered > 1` 自己就会停住，
// `atHistoryFloor`（has_before 权威答案）压根没被考验到。2026-09-10 试过变异，红不起来。
// 要真正考验它得造一个 `history_visible=1` 的群 + 一个入群后才有消息的新成员
// （那时 `oldest > 1` 恒真，只有 has_before 能让上滑停下来）。这条自检现在守住的是
// 「不会无限发请求」这个失败形态，以及本轮实测到的「本地已有的段里上滚零请求」。
import type { BrowserWindow } from "electron";

const STEP_TIMEOUT_MS = 20_000;
const POLL_MS = 250;
/** 上滚最多试几轮。到会话开头该远早于此收敛；跑满＝③ 没收敛。 */
const MAX_SCROLL_ROUNDS = 60;
/** 连续几轮零请求且上沿不再变，就认定「停下来了」。 */
const QUIET_ROUNDS = 4;
/** ② 反复进会话最多试几轮。收敛该在头几轮发生（每轮至多补上一窗右移探出的那点尾巴）。 */
const MAX_REENTRY_ROUNDS = 4;

type Say = (s: string) => void;

/** 一帧出站的 window_req。 */
type WindowReq = { convId: string; anchor: number; before: number; after: number };

/** 把 CDP 抓到的出站帧攒起来。只留 window_req——其余帧（sync_req/ack/…）不是本检查的判据。 */
class FrameTap {
  private reqs: WindowReq[] = [];

  constructor(private readonly win: BrowserWindow) {}

  async start(): Promise<void> {
    this.win.webContents.debugger.attach("1.3");
    this.win.webContents.debugger.on("message", (_e, method, params) => {
      if (method !== "Network.webSocketFrameSent") return;
      const raw = (params as { response?: { payloadData?: string } })?.response?.payloadData;
      if (!raw || !raw.includes("window_req")) return;
      try {
        const env = JSON.parse(raw) as { type?: string; data?: Record<string, unknown> };
        if (env.type !== "window_req") return;
        const d = env.data ?? {};
        this.reqs.push({
          convId: String(d.conv_id ?? ""),
          anchor: Number(d.anchor ?? 0),
          before: Number(d.before ?? 0),
          after: Number(d.after ?? 0),
        });
      } catch { /* 半帧/非 JSON：不是我们要的，丢掉 */ }
    });
    await this.win.webContents.debugger.sendCommand("Network.enable");
  }

  stop(): void {
    try { this.win.webContents.debugger.detach(); } catch { /* 已经断了就算了 */ }
  }

  /** 取走自上次调用以来攒下的帧。**取走即清零**，调用方按「这一段里发了几个」来判。 */
  drain(): WindowReq[] {
    const out = this.reqs;
    this.reqs = [];
    return out;
  }
}

async function waitFor(win: BrowserWindow, expr: string, what: string, timeoutMs = STEP_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await win.webContents.executeJavaScript(`!!(${expr})`)) as boolean) return;
    if (Date.now() > deadline) throw new Error(`等 ${what} 超时（${timeoutMs}ms）：${expr}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 往受控 input 写值：必须走原生 setter + 冒泡 input 事件，直接赋 `.value` React 收不到。 */
const TYPE_INPUT_JS = (idx: number, text: string): string => `(() => {
  const el = document.querySelectorAll('input')[${idx}];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
})()`;

const clickTextJs = (sel: string, text: string): string =>
  `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})]
      .find((e) => (e.textContent || '').includes(${JSON.stringify(text)}));
    if (!b) return false; b.click(); return true; })()`;

/** 点开名字含 `name` 的会话；找不到返回 false（调用方失败退出，不做兜底选择）。 */
const openConvJs = (name: string): string => `(() => {
  const hit = [...document.querySelectorAll('.convitem')]
    .find((e) => ((e.querySelector('.convpeer') || {}).textContent || '').includes(${JSON.stringify(name)}));
  if (!hit) return false; hit.click(); return true; })()`;

/** 当前渲染出来的最早一条 conv_seq（没有则 0）。上滚有没有前进、到没到顶，都看它。 */
const OLDEST_RENDERED_JS = `(() => {
  const xs = [...document.querySelectorAll('.msg-item[data-seq]')]
    .map((e) => Number(e.getAttribute('data-seq'))).filter((n) => n > 0);
  return xs.length ? Math.min(...xs) : 0; })()`;

/** 把消息容器推到顶并派发 scroll——onMsgsScroll 的上滚分支是靠事件触发的。 */
const SCROLL_TOP_JS = `(() => {
  const box = document.querySelector('.msgs');
  if (!box) return false;
  box.scrollTop = 0;
  box.dispatchEvent(new Event('scroll', { bubbles: true }));
  return true; })()`;

/** 登录（已有会话则跳过）。与 e2e 同一套路：等两种终态之一落定再决定走哪条路。 */
async function login(win: BrowserWindow, user: string, say: Say): Promise<void> {
  await waitFor(
    win,
    `document.body.innerText.includes('IM Web 登录') || document.querySelectorAll('.convitem').length > 0`,
    "登录页或会话列表（等页面落定）",
  );
  const loggedIn = (await win.webContents.executeJavaScript(
    `!document.body.innerText.includes('IM Web 登录')`,
  )) as boolean;
  if (loggedIn) { say(`[c3] 已有会话，跳过登录（本检查要求的是 ${user}，若不是请先退出登录）`); return; }
  await waitFor(win, `document.querySelectorAll('input').length > 0`, "登录表单");
  await win.webContents.executeJavaScript(TYPE_INPUT_JS(0, user));
  if (!(await win.webContents.executeJavaScript(clickTextJs("button", "免密登录")))) {
    throw new Error("登录页上找不到「免密登录」——后端没开 -dev-login？");
  }
  say(`[c3] 登录 ${user}`);
}

/** 进一次会话，返回这次进入期间发出的 window_req。 */
async function enterConv(win: BrowserWindow, tap: FrameTap, name: string, say: Say): Promise<WindowReq[]> {
  if (!(await win.webContents.executeJavaScript(openConvJs(name)))) {
    throw new Error(`找不到名字含「${name}」的会话`);
  }
  await waitFor(win, `document.querySelector('.msgs')`, "消息列表容器");
  await waitFor(win, `${OLDEST_RENDERED_JS} > 0`, "首屏消息上屏");
  await sleep(2000);   // 让进会话那一串异步（取数分流 → 落库 → 渲染）跑完再取帧
  const reqs = tap.drain();
  say(`[c3] 进会话「${name}」：window_req × ${reqs.length}${reqs.length ? ` → ${JSON.stringify(reqs)}` : ""}`);
  return reqs;
}

/** ③ 一路上滚，返回 { rounds, reqs, oldest, converged }。 */
async function scrollToTop(win: BrowserWindow, tap: FrameTap, say: Say): Promise<{
  rounds: number; total: number; oldest: number; converged: boolean;
}> {
  let total = 0;
  let quiet = 0;
  let lastOldest = -1;
  let rounds = 0;
  for (; rounds < MAX_SCROLL_ROUNDS; rounds++) {
    await win.webContents.executeJavaScript(SCROLL_TOP_JS);
    await sleep(700);
    const n = tap.drain().length;
    total += n;
    const oldest = (await win.webContents.executeJavaScript(OLDEST_RENDERED_JS)) as number;
    // 「停下来了」＝这一轮没发请求，**且**上沿也不再往前走（还在走说明只是本地展开，没到头）。
    quiet = n === 0 && oldest === lastOldest ? quiet + 1 : 0;
    lastOldest = oldest;
    if (quiet >= QUIET_ROUNDS) {
      say(`[c3] 上滚在第 ${rounds + 1} 轮收敛：累计 window_req × ${total}，上沿停在 conv_seq=${oldest}`);
      return { rounds: rounds + 1, total, oldest, converged: true };
    }
  }
  say(`[c3] 上滚跑满 ${MAX_SCROLL_ROUNDS} 轮仍未收敛：累计 window_req × ${total}，上沿 conv_seq=${lastOldest}`);
  return { rounds, total, oldest: lastOldest, converged: false };
}

export async function runC3Check(win: BrowserWindow, load: Promise<void>, say: Say): Promise<number> {
  const user = process.env.IM_C3_USER || "";
  const convName = process.env.IM_C3_CONV || "";
  // 跑哪几条。默认全跑；实际用法是分两次跑（大群跑 entry,scroll；读完的小会话跑 reentry）。
  const parts = new Set((process.env.IM_C3_PARTS || "entry,reentry,scroll").split(",").map((x) => x.trim()));
  // 「离开会话」怎么离：有别的会话就切过去，没有（压测账号常常只在一个群里）就**刷新页面**。
  // 刷新那条其实更贴近 C3 要验的场景——用户第二次点进来时本地已落库，该一个请求都不发。
  const otherName = process.env.IM_C3_OTHER || "";
  if (!user || !convName) {
    say("[c3] ✗ 至少需要 IM_C3_USER（登录名）与 IM_C3_CONV（目标会话名片段）；IM_C3_OTHER 可选（不给就用刷新页面来离开会话）");
    return 2;
  }

  const tap = new FrameTap(win);
  const fail: string[] = [];
  try {
    await tap.start();          // **必须在页面连 WS 之前**，否则头几帧抓不到
    await load;
    await login(win, user, say);
    await waitFor(win, `document.querySelectorAll('.convitem').length > 0`, "会话列表");
    tap.drain();                // 登录期间的帧与本检查无关，清掉

    // ① 第一次进会话：anchor ≥ 1
    const first = await enterConv(win, tap, convName, say);
    if (!parts.has("entry")) {
      say("[c3] · 跳过 ①（IM_C3_PARTS 未含 entry）");
    } else {
      const badAnchor = first.filter((r) => r.anchor <= 0);
      if (badAnchor.length) {
        fail.push(`第一次进会话的 anchor ≤ 0（${JSON.stringify(badAnchor)}）——撞上「取最新」哨兵，新成员进大群会一次清零全部未读`);
      } else if (first.length === 0) {
        say("[c3] · 第一次进会话没发 window_req（本地目录已命中；要验 ① 请换一个没进过的账号）");
      } else {
        say(`[c3] ✓ ① 第一次进会话 anchor 全部 ≥ 1（${first.map((r) => r.anchor).join(",")}）`);
      }
    }

    // ② 反复进同一个会话，请求次数要收敛到 0
    let reentryHit = parts.has("reentry") ? 0 : -1;
    if (!parts.has("reentry")) say("[c3] · 跳过 ②（IM_C3_PARTS 未含 reentry）");
    if (parts.has("reentry")) {
      for (let round = 1; round <= MAX_REENTRY_ROUNDS; round++) {
        if (otherName) {
          await enterConv(win, tap, otherName, say);
        } else {
          win.webContents.reload();
          await new Promise<void>((resolve) => { win.webContents.once("did-finish-load", () => resolve()); });
          await waitFor(win, `document.querySelectorAll('.convitem').length > 0`, "刷新后的会话列表");
          await sleep(2500);   // 让重连后的 sync 跑完，别把它的帧算到进会话头上
        }
        tap.drain();
        const again = await enterConv(win, tap, convName, say);
        if (again.length === 0) { reentryHit = round; break; }
      }
    }
    if (reentryHit === 0) {
      fail.push(`反复进同一个会话 ${MAX_REENTRY_ROUNDS} 轮，每轮都还在发 window_req——取数分流没生效，本地区间清单白建。（若目标是大积压会话，这条本就不适用，见文件头 ⚠️）`);
    } else if (reentryHit > 0) {
      say(`[c3] ✓ ② 重进会话第 ${reentryHit} 轮起零请求（本地目录命中）`);
    }

    // ③ 一路上滚到会话开头：请求要停
    if (!parts.has("scroll")) { say("[c3] · 跳过 ③（IM_C3_PARTS 未含 scroll）"); }
    const up = parts.has("scroll") ? await scrollToTop(win, tap, say) : { rounds: 0, total: 0, oldest: 0, converged: true };
    if (!up.converged) {
      fail.push(`上滚 ${MAX_SCROLL_ROUNDS} 轮仍在发 window_req（累计 ${up.total} 个）——has_before 那道闸没接上，每次上滑都空跑一次注定回空页的请求`);
    } else if (parts.has("scroll")) {
      say(`[c3] ✓ ③ 上滚会停：${up.rounds} 轮收敛，累计 ${up.total} 个 window_req，上沿 conv_seq=${up.oldest}`);
    }
  } catch (e) {
    say(`[c3] ✗ 跑挂了：${String(e)}`);
    return 3;
  } finally {
    tap.stop();
  }

  if (fail.length) { for (const f of fail) say(`[c3] ✗ ${f}`); return 1; }
  say("[c3] ✓ C3 取数分流三条判据全过");
  return 0;
}
