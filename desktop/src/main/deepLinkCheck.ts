// `--e2e` 的深链几步：链接从三条路进来，都要走到页面弹出扫码结果卡片。
//
// 用一个**不存在的** token：服务端 resolve 回 200110，页面弹「二维码已失效」——这恰好证明整条链路
// （主进程收 → 排队 → 通知 → preload 取 → useQR 订阅 → handleScanRaw → 服务端 → 卡片）都通了，
// 又不会真的加谁好友、进谁的群。
//
// 三条路 + 一条反向：
//   ① 冷启动：页面订阅**之前**就到的链接（macOS open-url 早于 ready / Windows argv）。
//      必须等登录后才出卡片——验的是「排队 + 订阅时先取一次」，这是最容易丢链接的一条。
//   ② 已在运行时 open-url（macOS）。
//   ③ 已在运行时 second-instance 的 argv（Windows / Linux）。data 给 self-check：只收链接不弹窗。
//   ④ 登录码 q/l 必须**不**出卡片。排在正向三条之后才有意义——链路要是整条断了，「没出卡片」恒真。
import { app, type BrowserWindow } from "electron";

/** 22 位 base62，与服务端 genToken 同形；库里不可能有它。 */
const FAKE_TOKEN = "DeepLinkE2eProbe000000";
const link = (kind: "u" | "g" | "l"): string => `imdesktop://q/${kind}/${FAKE_TOKEN}`;

const CARD_JS = `(() => { const m = document.querySelector('.qr-result-modal'); return !!m && m.innerText.includes('二维码已失效'); })()`;
const ANY_MODAL_JS = `!!document.querySelector('.qr-result-modal')`;
const CLOSE_JS = `(() => { const b = document.querySelector('.qr-result-modal .qr-close'); if (b) b.click(); return !!b; })()`;

const CARD_TIMEOUT_MS = 15_000;
/** 「不该出现」只能等一段再看。给宽：卡片要等一次服务端往返才出来。 */
const NOT_HAPPEN_MS = 2500;

async function poll(win: BrowserWindow, expr: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await win.webContents.executeJavaScript(`!!(${expr})`)) as boolean) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** 等卡片出来并关掉。返回失败原因，null = 通过。 */
async function expectCardThenClose(win: BrowserWindow, what: string): Promise<string | null> {
  if (!(await poll(win, CARD_JS, CARD_TIMEOUT_MS))) {
    return `${what}：${CARD_TIMEOUT_MS}ms 内没出「二维码已失效」卡片`;
  }
  await win.webContents.executeJavaScript(CLOSE_JS);
  if (!(await poll(win, `!(${ANY_MODAL_JS})`, 3000))) return `${what}：卡片出来了但关不掉（.qr-close 点不动）`;
  return null;
}

/** ① 的前半：在页面订阅之前投一条。**必须在 `await load` 之前调**。 */
export function seedColdDeepLink(): void {
  app.emit("open-url", { preventDefault: () => {} }, link("g"));
}

/** ① 的后半：登录后卡片要出来。调用时机：会话列表已出现（说明已登录、useQR 已订阅）。 */
export function expectColdDeepLinkCard(win: BrowserWindow): Promise<string | null> {
  return expectCardThenClose(win, "冷启动深链（订阅前排队的那条）");
}

/** ②③④。返回失败原因，null = 通过。 */
export async function checkWarmDeepLinks(win: BrowserWindow): Promise<string | null> {
  app.emit("open-url", { preventDefault: () => {} }, link("u"));
  const viaOpenUrl = await expectCardThenClose(win, "运行中 open-url");
  if (viaOpenUrl) return viaOpenUrl;

  app.emit("second-instance", {}, [process.execPath, link("g")], "", { kind: "self-check" });
  const viaArgv = await expectCardThenClose(win, "运行中 second-instance 的 argv");
  if (viaArgv) return viaArgv;

  app.emit("open-url", { preventDefault: () => {} }, link("l"));
  if (await poll(win, ANY_MODAL_JS, NOT_HAPPEN_MS)) {
    await win.webContents.executeJavaScript(CLOSE_JS);
    return "登录码 q/l 的深链弹出了卡片——deepLink.ts 的白名单被放宽了，网页能借深链发起扫码登录确认";
  }
  return null;
}
