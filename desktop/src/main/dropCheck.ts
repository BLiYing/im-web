// `--e2e` 的拖文件一步：在真 Chromium 里验 useFileDrop 的接线。
//
// 为什么 jsdom 那组测试不够：jsdom 没有 DataTransfer，那边的 `types` 含不含 "Files" 是测试自己手写的。
// 这里用真 `DataTransfer` + `items.add(File)`，验的是「浏览器真给出来的 types 能不能被认成文件拖拽」。
//
// ⚠️ **验不到的一半**：脚本派发的 drop 是 untrusted 事件，浏览器本来就不会为它执行默认行为
// （打开文件 / 把窗口导航到 file://），所以「落在聊天列外不导航」这里只能验到 defaultPrevented，
// 真的会不会导航走，要手拖一次文件到侧栏上看。
//
// **必须在发消息那步之前、且必须把拖进来的文件移除干净**：否则下一步按回车会把它一起发出去。
import type { BrowserWindow } from "electron";

const FILE_NAME = "desktop-e2e-drop.txt";

/** 造一个带真 DataTransfer（含一个文件）的拖拽事件并派发到 selector 命中的元素上，返回是否被拦。 */
const DISPATCH_JS = (selector: string, type: string): string => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const dt = new DataTransfer();
  dt.items.add(new File(['e2e'], ${JSON.stringify(FILE_NAME)}, { type: 'text/plain' }));
  const ev = new DragEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, dataTransfer: dt });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
})()`;

const CHIP_JS = `[...document.querySelectorAll('.paste-preview .paste-file-name')].some((e) => e.textContent === ${JSON.stringify(FILE_NAME)})`;
const REMOVE_JS = `(() => { const b = document.querySelector('.paste-preview .paste-remove'); if (b) b.click(); return !!b; })()`;

async function poll(win: BrowserWindow, expr: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await win.webContents.executeJavaScript(`!!(${expr})`)) as boolean) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** 返回失败原因，null = 通过。调用时机：已打开一个可发言的会话、还没往输入框里写东西。 */
export async function checkFileDrop(win: BrowserWindow): Promise<string | null> {
  const run = (sel: string, type: string) => win.webContents.executeJavaScript(DISPATCH_JS(sel, type)) as Promise<boolean | null>;

  // ① 落在聊天列外（侧栏）：必须拦，且不许进预览条。
  const outside = await run("aside", "drop");
  if (outside === null) return "页面里找不到侧栏 <aside>，拖拽检查没法做";
  if (!outside) return "落在聊天列外的文件拖拽没被拦——真拖的话浏览器会打开文件、桌面窗口会被导航到 file://";
  // 「不该发生」只能等一段再看：React 的状态更新是异步的。
  if (await poll(win, CHIP_JS, 800)) return "落在侧栏上的文件进了预览条——useFileDrop 没判落点是不是 .chat";

  // ② 落在聊天列里：dragover 与 drop 都要拦，且文件要进预览条。
  const over = await run(".chat .msgs", "dragover");
  const drop = await run(".chat .msgs", "drop");
  if (over === null || drop === null) return "页面里找不到 .chat .msgs，拖拽检查没法做";
  if (!over || !drop) return "落在聊天列里的文件拖拽没被拦——useFileDrop 没把真 DataTransfer 认成文件拖拽（types 不含 Files？）";
  if (!(await poll(win, CHIP_JS, 5000))) return "拖进聊天列之后预览条没出现——Composer 没接 useFileDrop，或 addPastedFiles 没进 ChatActions";

  // ③ 移除干净，别让下一步把它发出去。
  await win.webContents.executeJavaScript(REMOVE_JS);
  if (!(await poll(win, `!document.querySelector('.paste-preview')`, 3000))) {
    return "拖进来的文件从预览条里移除不掉——接下来发消息那步会把它一起发出去，已中止";
  }
  return null;
}
