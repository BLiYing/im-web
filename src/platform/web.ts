// 浏览器实现。**本文件的每一段都是从原处逐字搬来的**，D1 的验收是「im-web 行为零变化」，
// 所以这里不许顺手优化——搬家和改行为混在一次提交里，出了问题分不清是哪一件干的。
//
// 搬迁来源（原处已改为从本层取用）：
//   deviceId / deviceName  ← src/sdk/imSdk.ts（webDeviceId / webDeviceName，整段移入）
//   saveFile               ← src/useMediaDownload.ts（openReadyFile 的另存分支 + saveMessageToDisk，两处同一套 <a download>）
//   openExternal           ← src/useMediaDownload.ts（openReadyFile 的预览分支）
//   subscribeWake          ← src/sdk/wake.ts（installWakeListeners，**留在原处**，本层只转发）
//   voiceRecording         ← src/voiceRecorder.ts（voiceRecordingSupported，**留在原处**，本层只转发）
import type { GlobalShortcutState, NotifyRequest, Platform, SaveFileRequest, VoiceRecordingSupport } from "./types";
import { installWakeListeners } from "../sdk/wake";
import { voiceRecordingSupported } from "../voiceRecorder";

/** 本机稳定设备 ID（对齐 iOS 的 device_id）：首次生成一枚 UUID 落 localStorage，之后复用。
 *  后端按 (uid, device_id) 顶替去重——没有它，Web 每次刷新/重登都新建一条 session，设备列表会堆满同一台。
 *  localStorage 不可用（隐私模式/禁用）或读写抛错时回退每会话临时 ID，功能降级为不去重，但不崩。 */
const DEVICE_ID_KEY = "im.deviceId";
export function webDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID(); // localStorage 不可用：退化为一次性 ID（不去重，但不阻断登录）
  }
}

/** 概括本机为「浏览器 · 系统」，登录时上报作设备名（供设备管理页展示）。尽力而为，非精确。
 *  与后端 webDeviceName(UA) 同源，但浏览器端直接读 navigator，命中率更高。 */
export function webDeviceName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  if (!ua) return "网页版";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "浏览器";
  const os = /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/** 另存：造一个隐藏 `<a download>` 点一下。逐字搬自 useMediaDownload 的两处同款代码。
 *  `rel="noreferrer"` 与 appendChild/remove 的顺序都照原样——Safari 对不在文档里的 `<a>` 不触发下载。 */
export function webSaveFile(req: SaveFileRequest): void {
  const a = document.createElement("a");
  a.href = req.url; a.download = req.name; a.rel = "noreferrer";
  document.body.appendChild(a); a.click(); a.remove();
}

export const webPlatform: Platform = {
  name: "web",
  isDesktop: false,

  deviceId: webDeviceId,
  deviceName: webDeviceName,

  async saveFile(req: SaveFileRequest): Promise<void> {
    webSaveFile(req);
  },

  // 同步、不 await：保住用户手势的调用栈，否则被弹窗拦截器吃掉（见 types.ts 的说明）。
  openExternal(url: string): void {
    window.open(url, "_blank", "noopener,noreferrer");
  },

  // im-web 至今没有通知功能（全仓 new Notification 为 0 处）。如实返回 false，不假装做了。
  async notify(_req: NotifyRequest): Promise<boolean> {
    return false;
  },

  async setBadge(_count: number): Promise<boolean> {
    return false;
  },

  // 浏览器没有「开机自启」这个概念——不是没做，是不适用。设置页据此隐藏那一项。
  autoStartSupported(): boolean { return false; },
  async getAutoStart(): Promise<boolean> { return false; },
  async setAutoStart(_on: boolean): Promise<boolean> { return false; },

  // 浏览器没有页面之外的文案（托盘 / 原生对话框）——不适用。
  async setLanguage(_pref: string): Promise<void> { /* no-op */ },

  // 网页拿不到系统级按键——不适用。label 给空串：设置页根本不渲染这一项。
  globalShortcutSupported(): boolean { return false; },
  async getGlobalShortcut(): Promise<GlobalShortcutState> { return { enabled: false, label: "" }; },
  async setGlobalShortcut(_on: boolean): Promise<GlobalShortcutState> { return { enabled: false, label: "" }; },

  // web 的 notify 恒 false，没有通知可点，所以这个回调永远不会触发。
  // 仍返回一个可调用的拆除函数，让调用方不必分平台写 cleanup。
  subscribeOpenConversation(_cb: (convId: string) => void): () => void {
    return () => {};
  },

  // 浏览器没有深链入口：邀请链接在浏览器里打开的是落地页，走 `?qr=` 回放（useQR 的 bootQr）。
  subscribeDeepLink(_cb: (raw: string) => void): () => void {
    return () => {};
  },

  subscribeWake(onWake: (reason: string) => void): () => void {
    return installWakeListeners(onWake);
  },

  /** 浏览器没有别的本地库可选，恒 null → 回落 IndexedDB（那本来就是 web 的实现）。 */
  localStore: () => null,

  voiceRecording(): VoiceRecordingSupport {
    return voiceRecordingSupported();
  },
};
