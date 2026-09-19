// 通话动作的模块级出口：详情页 / 群资料页的按钮不在 CallProvider 之内，靠这里拿到 uikit 的 actions。
// RtcHost 里的 ActionsBridge 负责注册与注销；没注册 = 通话服务不可用（未配置 / 未登录 / 引擎没起来）。
import type { CallActions } from "im-rtc-call-uikit-react";

/** 群通话一次最多拉几个人（不含自己）。与 Android `MAX_CALL_PICK` 同口径。 */
export const MAX_GROUP_CALL_PICK = 8;

let current: CallActions | null = null;

export function registerCallActions(a: CallActions | null): void {
  current = a;
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
