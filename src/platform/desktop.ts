// 桌面（Electron）实现。**本文件不 import 任何 electron**——它只认 preload 经 contextBridge
// 注入的 `window.imDesktop`，所以它在浏览器里加载也不会炸，测试里给个假桥就能跑。
//
// D1 阶段外壳还不存在，本文件的实际作用是：把契约钉死，并保证「桥缺什么就退回 web 那份」。
// 这个逐能力回退不是过渡期的将就，是长期形状——外壳与页面各自发版，桥落后于页面是常态。
import type { NotifyRequest, Platform, SaveFileRequest, VoiceRecordingSupport } from "./types";
import { webPlatform } from "./web";
import { LOG_TAG, logger } from "../logging/logger";

/**
 * preload 注入的桥。**身份两项是值不是方法**——`deviceId`/`deviceName` 要同步取用
 * （见 types.ts），做成异步 IPC 会把 `IMClient` 的登录帧拼装拆成异步，那是行为改变。
 * 其余能力全部可选：桥没实现就回退 web。
 */
export interface DesktopBridge {
  /** 桥契约版本。页面比桥新时用它判断该不该走某条新路；D1 定为 1。 */
  readonly contract: number;
  readonly deviceId: string;
  readonly deviceName: string;
  saveFile?(url: string, name: string): Promise<void>;
  openExternal?(url: string): void;
  notify?(title: string, body: string, convId?: string): void;
  setBadge?(count: number): void;
  subscribeWake?(onWake: (reason: string) => void): () => void;
  voiceRecording?(): VoiceRecordingSupport;
}

declare global {
  interface Window {
    imDesktop?: DesktopBridge;
  }
}

/** 桥是否可用：契约版本 + 身份两项必须齐，缺一律当没有桥（宁可当浏览器跑，也不半残）。 */
export function isBridgeUsable(b: unknown): b is DesktopBridge {
  if (!b || typeof b !== "object") return false;
  const x = b as Partial<DesktopBridge>;
  return typeof x.contract === "number" && !!x.deviceId && !!x.deviceName;
}

/** 用一座桥造桌面 Platform。桥缺的能力逐个退回 `webPlatform`，并各记一条 debug（只记一次太吵，交给日志去重）。 */
export function createDesktopPlatform(bridge: DesktopBridge): Platform {
  const fellBack = (cap: string): void => {
    logger.debug(LOG_TAG.app, "platform_capability_fallback", { cap, contract: bridge.contract });
  };
  return {
    name: "desktop",
    isDesktop: true,

    deviceId: () => bridge.deviceId,
    deviceName: () => bridge.deviceName,

    async saveFile(req: SaveFileRequest): Promise<void> {
      if (!bridge.saveFile) { fellBack("saveFile"); return webPlatform.saveFile(req); }
      return bridge.saveFile(req.url, req.name);
    },

    openExternal(url: string): void {
      // 同步、fire-and-forget：理由同 web 侧（保用户手势）。桥这边即使是 IPC 也不许 await。
      if (!bridge.openExternal) { fellBack("openExternal"); webPlatform.openExternal(url); return; }
      bridge.openExternal(url);
    },

    notify(req: NotifyRequest): boolean {
      if (!bridge.notify) { fellBack("notify"); return webPlatform.notify(req); }
      bridge.notify(req.title, req.body, req.convId);
      return true;
    },

    setBadge(count: number): boolean {
      if (!bridge.setBadge) { fellBack("setBadge"); return webPlatform.setBadge(count); }
      bridge.setBadge(count);
      return true;
    },

    subscribeWake(onWake: (reason: string) => void): () => void {
      // 桥有自己的唤醒源（窗口聚焦 / 系统睡眠唤醒）时，仍要**叠加**浏览器那两个信号：
      // 渲染进程本身还是一个网页，`online` / `visibilitychange` 照样会来，丢掉等于少一半唤醒。
      const stopWeb = webPlatform.subscribeWake(onWake);
      if (!bridge.subscribeWake) { fellBack("subscribeWake"); return stopWeb; }
      const stopBridge = bridge.subscribeWake(onWake);
      return () => { stopBridge(); stopWeb(); };
    },

    voiceRecording(): VoiceRecordingSupport {
      if (!bridge.voiceRecording) { fellBack("voiceRecording"); return webPlatform.voiceRecording(); }
      return bridge.voiceRecording();
    },
  };
}
