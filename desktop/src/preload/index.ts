// preload：经 contextBridge 把桥挂到 window.imDesktop。**这是页面接触外壳的唯一通道**
// （DESKTOP_DESIGN §7.3 ②）——渲染进程不开 nodeIntegration，组件层也不得直接摸 window.imDesktop，
// 一律走 im-web 的 src/platform/。
//
// 身份两项从 `additionalArguments` 取而不是 IPC：preload 执行时就要拿到值，
// 页面里 `platform().deviceId()` 是同步调用（见 src/platform/types.ts 的说明）。
import { contextBridge, ipcRenderer } from "electron";

const IPC_OPEN_CONVERSATION = "im:open-conversation";   // 与 main/shellCaps.ts 同名，改一处要改两处
const IPC_STORE = "im:store";                           // 与 main/../shared/storeIpc.ts 同名，同上
//
// ⚠️ **preload 里不许 import 相对路径的模块**。它跑在 sandbox 里（webPreferences 没显式关，
// Electron 默认 sandbox:true），那份 `require` 只认 `electron` 与少数内置模块——
// 相对路径会在运行时 `module not found`，表现是 **preload 整个加载失败 → 桥没挂上 → 页面白屏**。
// 上面这两个常量之所以是双份字面量（而不是从 shared/ 引），根因就在这里，不是偷懒。
// 2026-09-09 实测：D4-3b 头一版从 `../shared/storeIpc` 引了常量，`npm run e2e` 当场白屏。

/** 从 `--im-xxx=value` 形式的启动参数里取一项。取不到返回空串，由下方判空兜底。 */
function argValue(flag: string): string {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : "";
}

const contract = Number(argValue("--im-contract")) || 0;
const deviceId = argValue("--im-device-id");
const deviceName = argValue("--im-device-name");

// 身份缺一不可：残缺的桥比没有桥更糟——页面会以为自己在桌面端，却拿到空 deviceId，
// 于是每次登录都在后端堆一条新 session。宁可不挂，让 platform() 回落 web。
// （im-web 的 isBridgeUsable() 也会再拦一道，这里是第一道。）
if (contract > 0 && deviceId && deviceName) {
  contextBridge.exposeInMainWorld("imDesktop", {
    contract,
    deviceId,
    deviceName,

    // ——D4-2 的三件（判断逻辑在页面侧 src/desktopNotify.ts，这里只是通道）——
    // **一律用 invoke（异步），不用 sendSync**：sendSync 会阻塞渲染进程等主进程回复，
    // 而这两个就挂在消息路径上（每条入站消息、每次未读数变化各一发）——为了一个 Dock 角标
    // 卡住 UI 线程是不划算的。另外主进程在自检模式下会 `await webContents.executeJavaScript(...)`
    // 等渲染进程，理论上与 sendSync 构成互等，也没有理由去趟这个险。
    // （**更正**：2026-09-08 那次 --e2e 卡住其实是 dist/ 陈旧，不是死锁——见 distFreshness.ts。
    //   本改动仍然成立，但当时的归因是错的，不该留在注释里。）
    setBadge: (count: number): Promise<boolean> => ipcRenderer.invoke("im:set-badge", count) as Promise<boolean>,
    notify: (title: string, body: string, convId?: string): Promise<boolean> =>
      ipcRenderer.invoke("im:notify", { title, body, convId }) as Promise<boolean>,
    autoStartSupported: (): boolean => process.platform === "darwin" || process.platform === "win32",
    // 这两个也改 invoke。原先用 sendSync，理由写的是「设置页是用户点出来的，那时主进程没在等
    // 渲染进程」——**那个理由不成立**：getAutoStart 实际在 React 首次挂载时就被调用（/code-review
    // 2026-09-08）。挂载那一刻主进程可能正等着页面，同步跨进程调用在那里是自找死锁。
    getAutoStart: (): Promise<boolean> => ipcRenderer.invoke("im:get-auto-start") as Promise<boolean>,
    setAutoStart: (on: boolean): Promise<boolean> => ipcRenderer.invoke("im:set-auto-start", on) as Promise<boolean>,

    /** 点系统通知后主进程把 convId 递过来。返回拆除函数——页面换号/卸载时必须调，
     *  否则旧回调会攒在 ipcRenderer 上（同 sdk/wake.ts 那个「不拆就跟着醒」的坑）。 */
    subscribeOpenConversation: (cb: (convId: string) => void): (() => void) => {
      const h = (_e: unknown, convId: string): void => cb(convId);
      ipcRenderer.on(IPC_OPEN_CONVERSATION, h);
      return () => { ipcRenderer.off(IPC_OPEN_CONVERSATION, h); };
    },

    /**
     * 本地消息库（D4-3b）。**这里一个方法名都不写**——只有一个通用转发口。
     *
     * 为什么不在这里把 15 个方法一一列出来：preload 不能 import 共享模块（见上面 sandbox 那段），
     * 逐个列举就意味着**第三份**方法名字面量（主进程一份、im-web 代理一份、这里再一份），
     * 而漏抄一个的表现是「那一个方法静默不工作」。少一份就少一处会漂移的地方。
     * 方法白名单的校验在主进程（`shared/storeIpc.ts` 的 `isStoreMethod`），
     * 名单本身与 im-web 侧那份由 `test/storeBridge.test.ts` 钉在一起。
     *
     * 一律异步：契约本来就全是 Promise，且这条通道挂在收发主路径上，`sendSync` 会阻塞渲染进程。
     * **整页写是一次调用**：`saveIncomingPage` 的一页消息 + 游标 + 区间打包成一发 IPC，
     * 主进程那侧在一个事务里提交。别为了"简化"把它拆成逐条（§7.6.3）。
     */
    localStore: {
      call: (method: string, args: unknown[]): Promise<unknown> =>
        ipcRenderer.invoke(IPC_STORE, { method, args }) as Promise<unknown>,
    },

    // 仍未实现（继续由 platform/desktop.ts 逐能力回退 web）：
    // saveFile / openExternal / subscribeWake / voiceRecording。
  });
}
