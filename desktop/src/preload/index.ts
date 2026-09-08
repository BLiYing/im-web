// preload：经 contextBridge 把桥挂到 window.imDesktop。**这是页面接触外壳的唯一通道**
// （DESKTOP_DESIGN §7.3 ②）——渲染进程不开 nodeIntegration，组件层也不得直接摸 window.imDesktop，
// 一律走 im-web 的 src/platform/。
//
// 身份两项从 `additionalArguments` 取而不是 IPC：preload 执行时就要拿到值，
// 页面里 `platform().deviceId()` 是同步调用（见 src/platform/types.ts 的说明）。
import { contextBridge, ipcRenderer } from "electron";

const IPC_OPEN_CONVERSATION = "im:open-conversation";   // 与 main/shellCaps.ts 同名，改一处要改两处

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
    // 这两个仍同步：设置页开关要立刻反映真实状态，且它们不在消息路径上、调用极少。
    // 用 sendSync 也安全——设置页是用户点出来的，那时主进程没有在等渲染进程。
    getAutoStart: (): boolean => ipcRenderer.sendSync("im:get-auto-start") as boolean,
    setAutoStart: (on: boolean): boolean => ipcRenderer.sendSync("im:set-auto-start", on) as boolean,

    /** 点系统通知后主进程把 convId 递过来。返回拆除函数——页面换号/卸载时必须调，
     *  否则旧回调会攒在 ipcRenderer 上（同 sdk/wake.ts 那个「不拆就跟着醒」的坑）。 */
    subscribeOpenConversation: (cb: (convId: string) => void): (() => void) => {
      const h = (_e: unknown, convId: string): void => cb(convId);
      ipcRenderer.on(IPC_OPEN_CONVERSATION, h);
      return () => { ipcRenderer.off(IPC_OPEN_CONVERSATION, h); };
    },

    // 仍未实现（继续由 platform/desktop.ts 逐能力回退 web）：
    // saveFile / openExternal / subscribeWake / voiceRecording。
  });
}
