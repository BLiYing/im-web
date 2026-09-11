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
import { app, type BrowserWindow } from "electron";
import { getNotifyCount } from "./shellCaps";
import { checkWarmDeepLinks, expectColdDeepLinkCard, seedColdDeepLink } from "./deepLinkCheck";
import { checkFileDrop } from "./dropCheck";

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
export async function runE2E(
  win: BrowserWindow,
  load: Promise<void>,
  say: Say,
  /** 主进程的本地库（D4-3b）。null = 没开起来，⑤ 会失败——理由见那一步的注释。 */
  store: { name: string; countMessagesWithContent(needle: string): number } | null,
): Promise<number> {
  const marker = `desktop-e2e ${new Date().toISOString()}`;

  // 渲染进程的报错要转出来。**没有这个的后果是「某一步超时了，但不知道为什么」**——
  // 页面里一个未捕获异常会让整棵树白屏，而自检看到的只是「元素没出现」，
  // 两者在输出上长得一模一样（2026-09-08 就为此瞎猜了两轮）。
  const rendererErrors: string[] = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) rendererErrors.push(message);   // 2=warning, 3=error
  });
  // 深链冷启动那条：**必须在页面订阅之前投**，才验得到「排队 + 订阅时先取一次」（见 deepLinkCheck.ts）。
  seedColdDeepLink();
  try {
    await load;
  } catch (e) {
    say(`[e2e] ✗ 页面加载失败：${String(e)}`);
    say("[e2e]   仓库根的 Vite 没起？cd .. && npm run dev");
    return 2;
  }

  try {
    // ① 登录。**不能只看"此刻有没有登录页"**——页面刚加载完时两种状态都还没落定，
    //    而 localStorage 里留着的 token 可能早被服务端吊销了（100101 session revoked），
    //    那时登录页要等一次失败的 /token/refresh 之后才出现。先判早的那一眼，
    //    就会得出「已有会话，跳过登录」然后卡死在等会话列表——**而且报错指向的是会话列表，
    //    根因却在登录**（2026-09-09 实测踩到：查了半天页面白屏，实际是会话被吊销了）。
    //    正确做法：等两种终态之一真的出现，再决定走哪条路。
    await waitFor(
      win,
      `document.body.innerText.includes('IM Web 登录') || document.querySelectorAll('.convitem').length > 0`,
      "登录页或会话列表（等页面落定）",
    );
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

    // ②b 冷启动深链：加载前投的那条，登录后卡片要出来。**必须在 ③ 之前关掉**，否则遮罩挡住会话点击。
    const cold = await expectColdDeepLinkCard(win);
    if (cold) {
      say(`[e2e] ✗ ${cold}`);
      say("[e2e]   链路：deepLink.ts 排队 → preload subscribeDeepLink 先取一次 → useQR 订阅 → handleScanRaw");
      return 12;
    }
    say("[e2e] ✓ 冷启动深链：页面订阅前到的链接，登录后弹出了扫码结果卡片");

    // ③ 打开目标会话。找不到就失败——绝不退化成「挑第一个」。
    const opened = (await win.webContents.executeJavaScript(OPEN_CONV_JS)) as boolean;
    if (!opened) {
      say(`[e2e] ✗ 找不到名字含「${TARGET_CONV}」的会话`);
      say("[e2e]   本检查只往它发消息，不会退化成挑一个真会话发。用 IM_E2E_CONV 指定别的名字。");
      return 4;
    }
    await waitFor(win, `document.querySelector('.msgs')`, "消息列表容器");
    say(`[e2e] ✓ 打开会话「${TARGET_CONV}」`);

    // ③b **批量投递不许产生系统通知**。打开会话会经 `window_resp` 一次投递一整页历史，
    //     而自检模式窗口不显示（`document.hasFocus()` 为 false），所以「窗口在前台」那道
    //     排除不生效——修复前这里每条历史都会弹一条通知（离线积压同理，只是更多）。
    //     这是唯一能观测到「弹没弹」的地方：通知弹出与否，从页面里看不见。
    const afterOpen = getNotifyCount();
    if (afterOpen > 0) {
      say(`[e2e] ✗ 打开会话就弹了 ${afterOpen} 条系统通知——批量投递被当成了实时消息`);
      say("[e2e]   看 imSdk 的 onMessage(live) 这一位有没有被调用方漏掉（App.tsx 的 onMessage）");
      return 8;
    }
    say("[e2e] ✓ 批量投递（一页历史）未产生系统通知");

    // ③c 拖文件进聊天列（真 DataTransfer）。**必须在 ④ 发消息之前**，且检查自己会把文件移除干净。
    const dropFail = await checkFileDrop(win);
    if (dropFail) {
      say(`[e2e] ✗ ${dropFail}`);
      return 13;
    }
    say("[e2e] ✓ 拖文件：侧栏上松手被拦且不收；聊天列里松手进预览条，已移除");

    // ④ 发一条。marker 带时间戳，重跑不会和上一次的混淆。
    await win.webContents.executeJavaScript(TYPE_JS(marker));
    await win.webContents.executeJavaScript(PRESS_ENTER_JS);
    await waitFor(win, `document.querySelector('.msgs').innerText.includes(${JSON.stringify(marker)})`, "消息上屏");
    say("[e2e] ✓ 发出并上屏");

    // ⑤ 上屏 ≠ 服务端收下了：本地会先乐观渲染一条「发送中」。
    //
    // ⚠️ **只等「发送中」消失是不够的**（/code-review 抓到）：发送**失败**的消息同样不含
    // 「发送中」——MessageList 里 `status==="sending"` 才渲染「发送中…」，失败态换成 `.fail-badge`
    // 红❗。于是后端一挂，门禁会对一条根本没发出去的消息打 ✓ 并 exit 0。
    // 所以三条一起断言：marker 在场、没有发送中、**且列表里没有失败徽标**。
    await waitFor(
      win,
      `document.querySelector('.msgs').innerText.includes(${JSON.stringify(marker)})
       && !document.querySelector('.msgs').innerHTML.includes('发送中')
       && document.querySelectorAll('.msgs .fail-badge').length === 0`,
      "服务端确认（发送态消失 + 无失败徽标）",
    );
    say("[e2e] ✓ 服务端已确认（发送态消失，且列表无失败徽标）");

    // 自己发的也不该弹（多端抄送会把它推回来）。到这里累计仍应为 0。
    const afterSend = getNotifyCount();
    if (afterSend > 0) {
      say(`[e2e] ✗ 自己发一条就弹了 ${afterSend} 条通知——shouldNotify 的「自己发的」那道排除没生效`);
      return 8;
    }
    say("[e2e] ✓ 自己发的消息未产生系统通知");

    // ⑥ 媒体相对路径。**这是选方案 B 的核心理由，所以必须验，不能只写在文档里**：
    // 消息与头像里存的是 /uploads、/avatars 相对路径（服务端不知道端可达的 host 故不绝对化，
    // 同一条约定见 im-android 的 data/MediaUrl.kt）。同源层在，它们就该照常加载。
    //
    // ⚠️ **不能数 DOM 里的 <img>**：代理前缀漏一条时，Avatar 的 onError 会把 <img> 摘掉换首字母，
    // 于是「一张都没有」——第一版检查就是这么把自己骗过去的（变异测试抓到）。
    // 改从 performance 资源表里取真实请求过的 URL，再重新 fetch 一次看 content-type。
    const media = (await win.webContents.executeJavaScript(`(async () => {
      const hits = performance.getEntriesByType('resource')
        .map((e) => e.name)
        .filter((n) => /\\/(uploads|avatars)\\//.test(n));
      if (!hits.length) return { total: 0 };
      // **不能只抽一个**（/code-review 抓到）：本工程有完整的「媒体失效」机制，服务端会清理
      // uploads，失效媒体是**正常状态**不是 bug。只抽 hits[0] 碰上一个已清理的就误报 exit 5，
      // 还把人往「代理前缀漏了一条」的错方向带。改成抽最多 5 个，**任一为 image/* 即算代理通**。
      const tried = [];
      for (const url of hits.slice(0, 5)) {
        try {
          const r = await fetch(url, { cache: 'no-store' });  // 绕开 HTTP 缓存：前几轮成功加载过的图会替坏掉的代理背书
          const type = r.headers.get('content-type') || '';
          tried.push({ url, status: r.status, type });
          if (r.status === 200 && type.startsWith('image/')) {
            return { total: hits.length, ok: true, url, status: r.status, type, tried: tried.length };
          }
        } catch (e) {
          tried.push({ url, status: 0, type: 'FETCH FAILED: ' + e.message });
        }
      }
      return { total: hits.length, ok: false, tried: tried.length, ...tried[tried.length - 1] };
    })()`)) as { total: number; ok?: boolean; url?: string; status?: number; type?: string; tried?: number };
    if (media.total === 0) {
      say("[e2e] – 相对路径媒体：本轮一次都没请求过，跳过（不算失败，但也没验到）");
    } else if (media.ok) {
      say(`[e2e] ✓ 相对路径媒体可达：${media.total} 个请求，抽验第 ${media.tried} 个命中 ${media.url} → ${media.status} ${media.type}`);
    } else {
      say(`[e2e] ✗ 抽验的 ${media.tried} 个相对路径媒体没有一个是图片，最后一个：${media.url} → ${media.status} ${media.type}`);
      say("[e2e]   若全是 404，先看同源层的代理前缀是否漏了一条（和仓库根 vite.config.ts 的 proxy 逐条对）；");
      say("[e2e]   若只是个别 404，那多半是服务端已清理的失效媒体，属正常——本检查已抽到 5 个才判负。");
      return 5;
    }

    // ⑦ D4-2 的桥：页面 → preload → ipcMain → 系统 API 整条打通了吗。
    //    只验 setBadge（有明确返回值、无可见副作用）；通知不在这里弹，那属 --shell-check。
    const bridge = (await win.webContents.executeJavaScript(`(async () => {
      const b = window.imDesktop;
      if (!b) return { present: false };
      const set = typeof b.setBadge === 'function' ? await b.setBadge(7) : null;
      if (typeof b.setBadge === 'function') await b.setBadge(0);   // 立刻清掉，别把 7 留在 Dock 上
      return { present: true, hasSetBadge: typeof b.setBadge === 'function',
               hasNotify: typeof b.notify === 'function',
               hasSubscribe: typeof b.subscribeOpenConversation === 'function',
               hasAutoStart: typeof b.getAutoStart === 'function', set };
    })()`)) as { present: boolean; hasSetBadge?: boolean; hasNotify?: boolean;
                 hasSubscribe?: boolean; hasAutoStart?: boolean; set?: unknown };
    if (!bridge.present) {
      say("[e2e] – 桥不在（浏览器模式），跳过 D4-2 桥检查");
    } else if (!bridge.hasSetBadge || !bridge.hasNotify || !bridge.hasSubscribe
               || !bridge.hasAutoStart || typeof bridge.set !== "boolean") {
      say(`[e2e] ✗ D4-2 桥不完整：${JSON.stringify(bridge)}`);
      say("[e2e]   setBadge 没返回 boolean 通常意味着 ipcMain 处理端没装（invoke 拿不到结果）");
      return 6;
    } else {
      say(`[e2e] ✓ D4-2 桥打通：setBadge/notify/subscribeOpenConversation/autoStart 齐备，setBadge(7)=${bridge.set}`);
    }

    // ⑧ D4-4 的三件：另存 / 外链 / 唤醒信号。
    //    `saveFile` 会弹保存对话框、`openExternal` 会拉起系统浏览器——**都不能在无人值守里真调**，
    //    所以这里只验「桥上有没有」。唯一能端到端验的是**唤醒信号**：它没有可见副作用，
    //    而且正是那条「合盖一夜再打开，网页那两个信号一个都不来」的路，值得真跑一次。
    if (!bridge.present) {
      say("[e2e] – 桥不在（浏览器模式），跳过 D4-4 桥检查");
    } else {
      const caps = (await win.webContents.executeJavaScript(`(() => {
        const b = window.imDesktop;
        return { save: typeof b.saveFile === 'function', open: typeof b.openExternal === 'function',
                 wake: typeof b.subscribeWake === 'function' };
      })()`)) as { save: boolean; open: boolean; wake: boolean };
      if (!caps.save || !caps.open || !caps.wake) {
        say(`[e2e] ✗ D4-4 桥不完整：${JSON.stringify(caps)}`);
        return 10;
      }
      // 唤醒信号走一遍真链路：页面订阅 → 主进程发 focus → 页面收到 → 拆除后不再收。
      // **拆除那一半必须验**：不拆的话换号后旧回调仍挂在 ipcRenderer 上，
      // 醒来会把已作废的会话拉回来（sdk/wake.ts 记着这个坑，2026-08-22 真出过）。
      await win.webContents.executeJavaScript(`(() => {
        window.__wake = [];
        window.__wakeOff = window.imDesktop.subscribeWake((r) => window.__wake.push(r));
      })()`);
      win.emit("focus");                                   // 与 app 的 browser-window-focus 同源
      app.emit("browser-window-focus", {}, win);
      await new Promise((r) => setTimeout(r, 300));
      const got = (await win.webContents.executeJavaScript(
        `(() => { window.__wakeOff(); const n = window.__wake.length; window.__wake = []; return n; })()`)) as number;
      app.emit("browser-window-focus", {}, win);           // 拆除之后再发一次
      await new Promise((r) => setTimeout(r, 300));
      const after = (await win.webContents.executeJavaScript(`window.__wake.length`)) as number;
      if (got < 1) {
        say("[e2e] ✗ 唤醒信号没到页面——主进程 installWakeSignals 没装，或频道名两侧不一致");
        return 10;
      }
      if (after !== 0) {
        say(`[e2e] ✗ 拆除后仍收到 ${after} 条唤醒信号——subscribeWake 返回的拆除函数没真拆`);
        return 10;
      }
      say(`[e2e] ✓ D4-4 桥打通：saveFile/openExternal 齐备；唤醒信号收到 ${got} 条，拆除后归零`);
    }

    // ⑨ 运行中的两条深链入口（open-url / second-instance argv）+ 登录码必须不出卡片。
    if (bridge.present) {
      const warm = await checkWarmDeepLinks(win);
      if (warm) {
        say(`[e2e] ✗ ${warm}`);
        return 12;
      }
      say("[e2e] ✓ 深链：运行中 open-url 与 second-instance argv 都弹出卡片，登录码 q/l 未弹");
    }

    // ⑩ 全局快捷键的桥：页面 → preload → ipcMain → globalShortcutCap 通不通、回的形状对不对。
    //    **只读不设**：set 会改用户偏好、抢用户的键。真注册器上的开 / 关归 --shell-check（它换了探针键）。
    if (bridge.present) {
      const gs = (await win.webContents.executeJavaScript(`(async () => {
        const b = window.imDesktop;
        if (typeof b.getGlobalShortcut !== 'function' || typeof b.setGlobalShortcut !== 'function'
            || typeof b.globalShortcutSupported !== 'function') return null;
        return { supported: b.globalShortcutSupported(), state: await b.getGlobalShortcut() };
      })()`)) as { supported: boolean; state?: { enabled?: unknown; label?: unknown } } | null;
      const st = gs?.state;
      if (!gs || typeof st?.enabled !== "boolean" || typeof st?.label !== "string" || (gs.supported && !st.label)) {
        say(`[e2e] ✗ 全局快捷键的桥不完整：${JSON.stringify(gs)}——get 拿不到 {enabled,label} 通常是 ipcMain 处理端没装`);
        return 14;
      }
      say(`[e2e] ✓ 全局快捷键桥打通：supported=${gs.supported} state=${JSON.stringify(st)}`);
    }
  } catch (e) {
    say(`[e2e] ✗ ${String(e instanceof Error ? e.message : e)}`);
    if (rendererErrors.length) {
      say("[e2e]   渲染进程报了错（多半就是根因，页面白屏与「元素没出现」在输出上一样）：");
      for (const m of rendererErrors.slice(0, 5)) say(`[e2e]     · ${m}`);
    } else {
      say("[e2e]   渲染进程无报错——那更像是后端没起或没开 -dev-login：");
      say("[e2e]   cd ../../IMServer && ./scripts/dev.sh --no-tail");
    }
    try {
      const body = (await win.webContents.executeJavaScript(
        `document.body.innerText.slice(0, 200)`)) as string;
      say(`[e2e]   页面当前文本：${JSON.stringify(body)}`);
    } catch { /* 页面都取不到文本了，就不追加了 */ }
    return 1;
  }

  // ⑤ **本地库真的是主进程 SQLite 吗**。
  //    这一步不能省：`platform().localStore()` 返回 null 时页面会**静默回落 IndexedDB**，
  //    而上面每一步照样全绿——桌面端跑着浏览器那套库，没有任何征兆。这正是本仓反复栽的
  //    那类 fail-open（§4.6.1~§4.6.4 四条都是同一个形状）。所以查的是**磁盘上那个库里有没有东西**，
  //    而不是问页面"你用的哪套"——问页面等于让被测者自证。
  if (!store) {
    say("[e2e] ✗ 主进程没有本地库实例——页面这会儿跑的是 IndexedDB，D4-3b 等于没接上");
    return 9;
  }
  if (store.name !== "desktop-sqlite") {
    say(`[e2e] ✗ 本地库实现不对：${store.name}`);
    return 9;
  }
  // 查的是**本轮刚发的那条 marker**，不是总行数：库在 userData 里是持久的，
  // 数总行数会被上一轮遗留的数据喂饱，把桥整个打断也恒真（头一版就是这么写的，
  // 变异验证当场抓到——护栏自己 fail-open 比没有护栏更糟）。
  const rows = store.countMessagesWithContent(marker);
  if (rows <= 0) {
    say(`[e2e] ✗ 本轮发的那条消息没进 SQLite（命中 ${rows} 条）——页面回落了 IndexedDB`);
    say("[e2e]   查 platform().localStore()：桥少了 localStore.call 就会整体回落");
    return 9;
  }
  say(`[e2e] ✓ 本地库是主进程 SQLite：本轮那条 marker 已落库（命中 ${rows} 条）`);

  say(`[e2e] ✓ D2 验收链路走通：登录 → 会话列表 → 收发一条消息（marker: ${marker}）`);
  return 0;
}
