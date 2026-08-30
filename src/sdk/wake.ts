// wake：**网络恢复秒连**——浏览器唤醒信号（`online` / 标签页重新可见）到来时，跳过指数退避立即重连。
//
// 为什么单开一个文件而不是塞进 IMClient：① `imSdk.ts` 有行数硬预算（`check-file-size.sh`；
// `sdk/resend.ts` 也是为此放在类外，本次仍不得不把预算 1450 → 1465，见该脚本注释）；② 这里两块东西本就不该长在类里——
// **判据是纯函数**（能单测，见 imSdk.test.ts），**监听是 DOM 细节**（类里塞 addEventListener
// 还要自己管拆除，换号新建 IMClient 时最容易漏）。类里只留一个把两者接起来的薄入口 `reconnectNow`。
//
// 与 iOS 对称：`IMSocketManager` 的 `IMSocketWakeActionFor` / `reconnectNowWithReason:`，判据同口径。

// 只取类型：`import type` 不产生运行时依赖，故与 imSdk.ts 互引不会形成循环 import。
import type { ConnState } from "./imSdk";

/** 唤醒信号该做什么。 */
export type WakeAction = "none" | "reconnect" | "probe";

/**
 * 唤醒判据。真正的坑不在"连一下"，而在**什么时候不该连**：
 * - `manualClose` 后不能连：退出登录 / 被踢下线（auth 码）都置它，自动重连等于把用户的登出撤销，
 *   也会让"被踢"退化成一次临时抖动；
 * - `connecting` 时不能再连：会掐掉正在握手的那条，反而更慢；
 * - `connected` 时只**探活**：重连等于白白断一次好连接。socket 若其实已死（后台标签页/系统挂起后
 *   常见），ping 写失败或随后的 onclose 会走既有重连路径，且那时 `reconnectAttempts` 已因上次
 *   连接成功归零，1s 即重试。
 */
export function wakeActionFor(state: ConnState, manualClose: boolean): WakeAction {
  if (manualClose) return "none";
  if (state === "connected") return "probe";
  if (state === "connecting") return "none";
  return "reconnect";
}

/** 唤醒时要执行的两个动作（由 IMClient 注入，本模块不碰它的私有状态）。 */
export interface WakePort {
  /** 已连接：发一次心跳探活。 */
  probe: () => void;
  /** 未连接：清掉在途退避定时器、把退避档位清零、立刻连一次。 */
  reconnect: () => void;
}

/** 按判据执行。返回实际执行的动作，便于调用方打日志/测试。 */
export function runWake(state: ConnState, manualClose: boolean, port: WakePort): WakeAction {
  const action = wakeActionFor(state, manualClose);
  if (action === "probe") port.probe();
  else if (action === "reconnect") port.reconnect();
  return action;
}

/**
 * 装浏览器唤醒监听，返回**拆除函数**。
 * - `online`：网络恢复；
 * - `visibilitychange`：标签页从后台回到前台——后台期间 socket 可能已被浏览器或中间设备静默断掉，
 *   而本端还没收到 close 帧。
 *
 * 调用方须在 `disconnect()` 里调拆除函数：App 换号会新建 IMClient 并断开旧的，不拆的话旧实例
 * 会跟着一起醒来重连，把已经作废的会话拉回来（这个坑 2026-08-22 以另一种形态出现过：
 * 被顶替的旧 client 自排重连、拿已吊销 token 探活，把健康的新会话一起踢回登录页）。
 * 非浏览器环境（SSR / node 测试）返回空函数，不做任何事。
 */
export function installWakeListeners(onWake: (reason: string) => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const onOnline = () => onWake("browser_online");
  const onVisible = () => { if (document.visibilityState === "visible") onWake("tab_visible"); };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
