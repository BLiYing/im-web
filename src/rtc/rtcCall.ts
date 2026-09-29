// 通话动作 / 引擎本体的模块级出口：详情页 / 群资料页的按钮、通话记录页都不在 CallProvider 树内，
// 靠这里拿到 uikit 的 actions 和 engine 本体。两者**不是同一个生命周期**：engine 在 RtcHost 的
// startRtcEngine effect 里就绪（登录后即有），actions 要等 CallProvider 的子组件 ActionsBridge
// 拿到 uikit 内部状态才就绪（比 engine 晚半拍），所以特意分开注册、不揉进一个对象——合并成一个
// `{actions, engine}` 会让"引擎已经能查通话记录了"被迫等到"uikit actions 也齐了"才通知订阅者，
// 对通话记录页是个平白无故的延迟。
import type { CallActions } from "im-rtc-call-uikit-react";
import type { CallEngine } from "im-rtc-call-engine";

/** 群通话一次最多拉几个人（不含自己）。与 Android `MAX_CALL_PICK` 同口径。 */
export const MAX_GROUP_CALL_PICK = 8;

/** 「持有一个值 + 变化时通知订阅者」的小工厂——actions/engine 是同一种形状，用它避免重复样板代码
 * （/code-review 2026-09-29：此前两者各手写一份 let + 通知逻辑，容易在以后照抄出第三份）。 */
function createSingletonRegistry<T>() {
  let current: T | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (): T | null => current,
    set: (value: T | null): void => {
      current = value;
      listeners.forEach((fn) => fn());
    },
    /** 订阅值更替（含从有到无、从无到有）；返回取消订阅函数。 */
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const actionsRegistry = createSingletonRegistry<CallActions>();

/** RtcHost 里的 ActionsBridge 负责注册与注销；没注册 = 通话服务不可用（未配置 / 未登录 / 引擎没起来）。 */
export function registerCallActions(a: CallActions | null): void {
  actionsRegistry.set(a);
}

const engineRegistry = createSingletonRegistry<CallEngine>();

/** RtcHost 起停引擎时登记 / 反登记，见那里 setEngine 旁的 registerCallEngine 调用。 */
export function registerCallEngine(e: CallEngine | null): void {
  engineRegistry.set(e);
}

/** 通话服务未就绪（未登录 / 引擎没起来）时返回 null，调用方按此显示「未登录」态而非报错。 */
export function getCallEngine(): CallEngine | null {
  return engineRegistry.get();
}

/** 订阅引擎更替；用于组件挂载时引擎还没就绪、之后才 registerCallEngine 就绪的场景——不订阅这个
 * 事件就永远等不到"引擎后来才好了"这个通知（/code-review 2026-09-29 发现：useCallHistory
 * 原先只在挂载那一刻读一次 getCallEngine()）。 */
export function onCallEngineChange(listener: () => void): () => void {
  return engineRegistry.subscribe(listener);
}

/** 通话服务是否就绪。 */
export function rtcReady(): boolean {
  return actionsRegistry.get() !== null;
}

/** 单聊 1v1：`video=true` 视频，否则语音。就绪返回 true。 */
export function placeSingleCall(peerUid: string, video: boolean): boolean {
  const actions = actionsRegistry.get();
  if (!actions) return false;
  void actions.placeCall([peerUid], video ? "video" : "audio");
  return true;
}

/** 群通话：类型固定 video（默认不开摄像头由 Kit 决定），chatGroupId = 群会话 id。 */
export function placeGroupCall(chatGroupId: string, calleeUids: string[]): boolean {
  const actions = actionsRegistry.get();
  if (!actions) return false;
  void actions.placeCall(calleeUids.slice(0, MAX_GROUP_CALL_PICK), "video", { isGroup: true, chatGroupId });
  return true;
}
