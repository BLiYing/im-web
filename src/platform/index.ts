// 平台适配层的**唯一入口与唯一判定点**（DESKTOP_DESIGN §7.3 ③）。
//
// 全仓不许出现第二个「我是不是桌面端」的判断——多一处就是多一处会漂移的分叉。
// 需要按宿主分流时，加一个 `Platform` 方法，不要在业务代码里 `if (window.imDesktop)`。
import type { Platform } from "./types";
import { webPlatform } from "./web";
import { createDesktopPlatform, isBridgeUsable } from "./desktop";

export type { Platform, NotifyRequest, SaveFileRequest, VoiceRecordingSupport } from "./types";
export type { DesktopBridge } from "./desktop";

let cached: Platform | null = null;

/** 选一次实现。桥不可用（浏览器 / node 测试 / 桥半残）一律回落 web。 */
function detect(): Platform {
  const bridge = typeof window === "undefined" ? undefined : window.imDesktop;
  return isBridgeUsable(bridge) ? createDesktopPlatform(bridge) : webPlatform;
}

/**
 * 取当前宿主的能力面。
 *
 * **缓存是有意的**：桥在 preload 期就注入完毕，运行中不会凭空长出来；每次调用重新探测
 * 只会让「同一次会话里前后拿到不同实现」变成可能——那种不一致比慢一点难查得多。
 */
export function platform(): Platform {
  return (cached ??= detect());
}

/** 仅供测试：清掉缓存，让下次 `platform()` 重新探测。生产代码不要调。 */
export function resetPlatformForTests(): void {
  cached = null;
}
