// 通话动作的模块级出口：详情页 / 群资料页的按钮不在 CallProvider 之内，靠这里拿到 uikit 的 actions。
// RtcHost 里的 ActionsBridge 负责注册与注销；没注册 = 通话服务不可用（未配置 / 未登录 / 引擎没起来）。
import type { CallActions } from "im-rtc-call-uikit-react";
import type { CallEngine } from "im-rtc-call-engine";

/** 群通话一次最多拉几个人（不含自己）。与 Android `MAX_CALL_PICK` 同口径。 */
export const MAX_GROUP_CALL_PICK = 8;

let current: CallActions | null = null;

export function registerCallActions(a: CallActions | null): void {
  current = a;
}

// 通话记录页（设置 ▸ 最近通话）同样不在 CallProvider 树内，但需要 engine 本体调 `fetchCallHistory` /
// 监听 `callEnd`（uikit 的 CallActions 不含这两个）。与上面 registerCallActions 同一套模块级出口模式：
// RtcHost 起停引擎时登记 / 反登记，见那里 setEngine 旁的 registerCallEngine 调用。
let currentEngine: CallEngine | null = null;

export function registerCallEngine(e: CallEngine | null): void {
  currentEngine = e;
}

/** 通话服务未就绪（未登录 / 引擎没起来）时返回 null，调用方按此显示「未登录」态而非报错。 */
export function getCallEngine(): CallEngine | null {
  return currentEngine;
}

/** 通话服务是否就绪。 */
export function rtcReady(): boolean {
  return current !== null;
}

/** 单聊 1v1：`video=true` 视频，否则语音。就绪返回 true。 */
export function placeSingleCall(peerUid: string, video: boolean): boolean {
  if (!current) return false;
  void current.placeCall([peerUid], video ? "video" : "audio");
  return true;
}

/** 群通话：类型固定 video（默认不开摄像头由 Kit 决定），chatGroupId = 群会话 id。 */
export function placeGroupCall(chatGroupId: string, calleeUids: string[]): boolean {
  if (!current) return false;
  void current.placeCall(calleeUids.slice(0, MAX_GROUP_CALL_PICK), "video", { isGroup: true, chatGroupId });
  return true;
}
