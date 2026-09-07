// `--e2e`：D2 的**验收自检**——登录 → 会话列表 → 收发一条消息，全程无人值守。
//
// 为什么值得写：D2 的验收标准就是这一条链路（DESKTOP_DESIGN §10）。「我看见窗口弹出来了」
// 既不可重跑，也证明不了页面在外壳里真的能连上后端——渲染进程的 WebSocket、localStorage、
// 同源代理在 Electron 里都和浏览器有细微差别，编译过完全不代表通。
//
// 前置：① 仓库根 `npm run dev` 起着 Vite；② 后端起着且开了 `-dev-login`
//       （`cd ../../IMServer && ./scripts/dev.sh --no-tail`）。
// 缺任何一项都会在对应那步失败并说清楚是哪一步，不会静默过。
//
// **只往 `IM_E2E_CONV`（默认「冒烟测试」）匹配的会话发**，找不到就失败退出——
// 绝不退化成「挑第一个会话发」，那会把测试消息发进真实会话甚至大群。
import type { BrowserWindow } from "electron";

const TARGET_CONV = process.env.IM_E2E_CONV || "冒烟测试";
const STEP_TIMEOUT_MS = 15_000;
const POLL_MS = 250;

type Say = (s: string) => void;

/** 在渲染进程里轮询一个返回布尔的表达式，直到为真或超时。 */
async function waitFor(win: BrowserWindow, expr: string, what: string, timeoutMs = STEP_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = (await win.webContents.executeJavaScript(`!!(${expr})`)) as boolean;
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`等 ${what} 超时（${timeoutMs}ms）：${expr}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** 往 React 受控 textarea 写值：必须走原生 setter + 冒泡 input 事件，
 *  直接赋 `.value` React 收不到，输入框会在下一次渲染时被打回原样。 */
const TYPE_JS = (text: string): string => `(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(text)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
  return ta.value;
})()`;

const PRESS_ENTER_JS = `(() => {
  const ta = document.querySelector('textarea');
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return true;
})()`;

/** 点开名字含 TARGET_CONV 的会话；找不到返回 false（调用方据此失败退出，不做兜底选择）。 */
const OPEN_CONV_JS = `(() => {
  const rows = [...document.querySelectorAll('.convitem')];
  const hit = rows.find((e) => (e.querySelector('.convpeer')?.textContent || '').includes(${JSON.stringify(TARGET_CONV)}));
  if (!hit) return false;
  hit.click();
  return true;
})()`;

/** 跑一遍验收链路，返回进程退出码（0=通过）。每一步失败都自带「该去看哪儿」。 */
export async function runE2E(win: BrowserWindow, load: Promise<void>, say: Say): Promise<number> {
  const marker = `desktop-e2e ${new Date().toISOString()}`;
  try {
    await load;
  } catch (e) {
    say(`[e2e] ✗ 页面加载失败：${String(e)}`);
    say("[e2e]   仓库根的 Vite 没起？cd .. && npm run dev");
    return 2;
  }

  try {
    // ① 登录。已有会话（localStorage 里留着 token）就直接跳过。
    const loggedIn = (await win.webContents.executeJavaScript(
      `!document.body.innerText.includes('IM Web 登录')`,
    )) as boolean;
    if (!loggedIn) {
      say("[e2e] 登录页 → 点「免密登录」");
      await waitFor(win, `[...document.querySelectorAll('button')].some(b => b.textContent.includes('免密登录'))`, "登录按钮");
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find(b => b.textContent.includes('免密登录')).click()`,
      );
    } else {
      say("[e2e] 已有会话，跳过登录");
    }

    // ② 会话列表。这一步过了，说明渲染进程里的 WebSocket + HTTP 代理在外壳里是通的。
    await waitFor(win, `document.querySelectorAll('.convitem').length > 0`, "会话列表");
    const n = (await win.webContents.executeJavaScript(`document.querySelectorAll('.convitem').length`)) as number;
    say(`[e2e] ✓ 会话列表 ${n} 行`);

    // ③ 打开目标会话。找不到就失败——绝不退化成「挑第一个」。
    const opened = (await win.webContents.executeJavaScript(OPEN_CONV_JS)) as boolean;
    if (!opened) {
      say(`[e2e] ✗ 找不到名字含「${TARGET_CONV}」的会话`);
      say("[e2e]   本检查只往它发消息，不会退化成挑一个真会话发。用 IM_E2E_CONV 指定别的名字。");
      return 4;
    }
    await waitFor(win, `document.querySelector('.msgs')`, "消息列表容器");
    say(`[e2e] ✓ 打开会话「${TARGET_CONV}」`);

    // ④ 发一条。marker 带时间戳，重跑不会和上一次的混淆。
    await win.webContents.executeJavaScript(TYPE_JS(marker));
    await win.webContents.executeJavaScript(PRESS_ENTER_JS);
    await waitFor(win, `document.querySelector('.msgs').innerText.includes(${JSON.stringify(marker)})`, "消息上屏");
    say("[e2e] ✓ 发出并上屏");

    // ⑤ 上屏 ≠ 服务端收下了：本地会先乐观渲染一条「发送中」。等发送态消失才算真的走完一圈。
    await waitFor(
      win,
      `document.querySelector('.msgs').innerText.includes(${JSON.stringify(marker)})
       && !document.querySelector('.msgs').innerHTML.includes('发送中')`,
      "服务端确认（发送态消失）",
    );
    say("[e2e] ✓ 服务端已确认（发送态消失）");
  } catch (e) {
    say(`[e2e] ✗ ${String(e instanceof Error ? e.message : e)}`);
    say("[e2e]   后端没起或没开 -dev-login？cd ../../IMServer && ./scripts/dev.sh --no-tail");
    return 1;
  }

  say(`[e2e] ✓ D2 验收链路走通：登录 → 会话列表 → 收发一条消息（marker: ${marker}）`);
  return 0;
}
