// preload：经 contextBridge 把桥挂到 window.imDesktop。**这是页面接触外壳的唯一通道**
// （DESKTOP_DESIGN §7.3 ②）——渲染进程不开 nodeIntegration，组件层也不得直接摸 window.imDesktop，
// 一律走 im-web 的 src/platform/。
//
// 身份两项从 `additionalArguments` 取而不是 IPC：preload 执行时就要拿到值，
// 页面里 `platform().deviceId()` 是同步调用（见 src/platform/types.ts 的说明）。
import { contextBridge } from "electron";

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
    // D2 只提供身份。saveFile / openExternal / notify / setBadge / subscribeWake /
    // voiceRecording 一概不实现 —— platform/desktop.ts 会逐能力回退到 web 实现，
    // 那正是「外壳与页面各自发版、桥落后于页面」的常态形状。这些归 D4/D5。
  });
}
