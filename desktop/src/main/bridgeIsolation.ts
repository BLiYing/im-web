// blob:/data: 子窗**不许挂桥**——程序化验一遍。
//
// 来历：2026-09-09 的 /code-review 提了一条——`index.ts` 的 `setWindowOpenHandler` 对
// blob:/data: 传的是 `webPreferences: { preload: undefined, … }`，而 Electron 对
// `webPreferences` 是**合并语义**，`undefined` 在部分路径上等同「未指定」，于是父窗那个
// preload 可能被继承，子窗照样挂着完整的 `window.imDesktop`（含能读写本地消息库的
// `localStore.call`）。当时判定「改法要先实测才能定」，挂了起来。
//
// **2026-09-10 实测结论：这条在 Electron 44 上不成立，桥没有泄漏。**
// 在 preload 的守卫之前插探针跑了一轮：blob: 子窗里 `window.imPreloadProbe` 也是 null
// ——preload **压根没执行**，不是执行了但守卫拦住。把那行 `webPreferences` 覆盖整个删掉
// （＝完全不设防）子窗依然没有桥，所以 `window.open` 造出的子窗在这个版本上本来就不继承
// preload，那行 `preload: undefined` 是个 no-op，但也没有害处，留着表明意图。
// （用户手测时敲出来是个带 deviceName 的对象——那是**主窗**的控制台：主窗本来就该有桥，
//   而 `deviceName` 恰好是 "IM Desktop · macOS …"，看起来很像子窗泄漏。）
//
// 那为什么还要留这个文件：**上面那条结论是版本相关的**，Electron 改一次继承规则就会翻，
// 而翻了之后画面完全正常、没有任何报错——媒体预览窗照样显示图片，只是多挂了一座桥。
// 这种「不报错、只是答案悄悄不对」的东西只能靠自检守。本检查已做双向变异验证：
// 显式把 preload 写进 `overrideBrowserWindowOptions` 后四个形状全部转红，
// 报出的正是那 13 个桥方法名。
//
// **变体不能只测一种**：真实预览走的是 `useMediaDownload` 预览分支 →
// `platform/desktop.ts` 的 `openExternal` → `webPlatform.openExternal` →
// `window.open(url, "_blank", "noopener,noreferrer")`，且 blob 的 MIME 是图片。
// 窗口特性（noopener）与文档类型（图片文档 vs HTML 文档）都可能改变 Electron 走哪条
// 创建路径，只测一种＝可能测了个不漏的形状然后宣布没事。
import { BrowserWindow } from "electron";

/** 等一个「该发生的事」，成功即返回；超时返回 false。 */
async function waitUntil(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pred()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** 一个待验的开窗形状。`features` 原样交给 `window.open` 的第三参。 */
export type OpenVariant = {
  name: string;
  /** blob 的 MIME。图片走图片文档，text/html 走 HTML 文档。 */
  mime: string;
  features: string;
};

/** 真实路径排第一：预览已下载图片时就是这个形状。其余是相邻形状，防「只有某一种漏」。 */
export const OPEN_VARIANTS: readonly OpenVariant[] = [
  { name: "图片 blob + noopener（真实预览路径）", mime: "image/png", features: "_blank|noopener,noreferrer" },
  { name: "图片 blob，无 features", mime: "image/png", features: "" },
  { name: "HTML blob + noopener", mime: "text/html", features: "_blank|noopener,noreferrer" },
  { name: "HTML blob，无 features", mime: "text/html", features: "" },
];

export type VariantResult = { name: string; ok: boolean; detail: string };

/** 1×1 透明 PNG 的字节，用来造一个真的能被当图片文档解析的 blob。 */
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** 在渲染进程里造 blob 并 `window.open`，返回是否调用成功。 */
function openJs(v: OpenVariant): string {
  const [target, feats] = v.features ? v.features.split("|") : ["", ""];
  const body = v.mime.startsWith("image/")
    ? `Uint8Array.from(atob(${JSON.stringify(PNG_1X1_BASE64)}), (c) => c.charCodeAt(0))`
    : `"<title>bridge-check</title>"`;
  const args = v.features
    ? `u, ${JSON.stringify(target)}, ${JSON.stringify(feats)}`
    : `u`;
  return `(() => {
    const u = URL.createObjectURL(new Blob([${body}], { type: ${JSON.stringify(v.mime)} }));
    return !!window.open(${args});
  })()`;
}

/** 问一个已建好的子窗：桥在不在。返回人话结论。 */
async function inspect(child: BrowserWindow): Promise<{ ok: boolean; detail: string }> {
  if (child.webContents.isLoading()) {
    await new Promise<void>((resolve) => {
      const done = (): void => resolve();
      child.webContents.once("did-finish-load", done);
      child.webContents.once("did-fail-load", done);
      setTimeout(done, 3000);
    });
  }
  const kind = (await child.webContents.executeJavaScript("typeof window.imDesktop").catch(() => "<读不出来>")) as string;
  if (kind === "undefined") return { ok: true, detail: "window.imDesktop === undefined" };
  // 有桥时把「有多严重」一并报出来：光说「不是 undefined」，下次读的人还得自己去翻桥上有什么。
  const keys = (await child.webContents
    .executeJavaScript("Object.keys(window.imDesktop || {}).join(',')")
    .catch(() => "<读不出来>")) as string;
  return { ok: false, detail: `挂着桥：typeof=${kind}，键=[${keys}]` };
}

/**
 * 逐个形状 `window.open` 一个 blob: 窗口，问它 `typeof window.imDesktop`。
 *
 * 走的是**真实那条路**（渲染进程调 `window.open` → `setWindowOpenHandler`），
 * 不是直接 `new BrowserWindow`——后者绕开被测代码，证明不了任何东西。
 */
export async function checkChildWindowBridge(win: BrowserWindow): Promise<VariantResult[]> {
  const out: VariantResult[] = [];
  for (const v of OPEN_VARIANTS) {
    let child: BrowserWindow | null = null;
    const grab = (w: BrowserWindow): void => { child = w; };
    win.webContents.once("did-create-window", grab);
    const opened = (await win.webContents.executeJavaScript(openJs(v)).catch(() => false)) as boolean;
    const got = await waitUntil(() => child !== null, 3000);
    win.webContents.removeListener("did-create-window", grab);

    if (!got) {
      out.push({
        name: v.name,
        ok: false,
        detail: opened
          ? "window.open 没造出子窗——setWindowOpenHandler 把 blob: 拒了？那媒体预览会打不开"
          : "渲染进程里 window.open 直接失败了，这条没验成（页面没加载完？）",
      });
      continue;
    }
    const c = child as unknown as BrowserWindow;
    try {
      out.push({ name: v.name, ...(await inspect(c)) });
    } finally {
      if (!c.isDestroyed()) c.destroy();
    }
  }
  return out;
}
