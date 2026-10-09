// 通话动作 / 引擎本体的模块级出口：详情页 / 群资料页的按钮、通话记录页都不在 CallProvider 树内，
// 靠这里拿到 uikit 的 actions 和 engine 本体。两者**不是同一个生命周期**：engine 在 RtcHost 的
// createRtcEngine effect 里就绪（建好即有，登录由 Kit 负责），actions 要等 CallProvider 的子组件 ActionsBridge
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
  if (a && pending) {
    const p = pending;
    pending = null;
    if (Date.now() - p.at <= PENDING_TTL_MS) p.run(a);
  }
}

// —— 被服务端踢下线后的现场重启 ——
// 被顶号 / 配置被拒时 RtcHost 会把引擎收掉（actions 随 CallProvider 卸载而注销），此前这之后每次点呼叫都只会提示
// 「通话服务不可用」，重新登录救不了被踢。现在：账号还在（RtcHost 仍挂载）就在用户点呼叫那一刻重建引擎，
// 等 actions 重新就绪后把这次呼叫补发出去；退出登录（RtcHost 卸载）后不再重启。

/** 呼叫入口发现引擎没在跑时要不要现场重启：引擎在跑不用；没有账号（已退出登录 / 从没起过）不能重启。纯函数，便于单测。 */
export function shouldRestartRtc(engineRunning: boolean, hasAccount: boolean): boolean {
  return !engineRunning && hasAccount;
}

/** 重启请求方：RtcHost 注册，返回 true 表示已发起重启（actions 稍后就绪）。 */
let restartRequester: (() => boolean) | null = null;

/** 重启期间排着的那一次呼叫。 */
let pending: { run: (a: CallActions) => void; at: number } | null = null;
/** 排队的呼叫超过这个时间还没等到 actions 就作废（重启失败时别在很久以后突然拨出去）。 */
const PENDING_TTL_MS = 15_000;

/** RtcHost 挂载时注册、卸载时注销（注销同时作废排着的呼叫）。 */
export function registerRtcRestart(fn: (() => boolean) | null): void {
  restartRequester = fn;
  if (!fn) pending = null;
}

/** 有 actions 就立即执行；没有则尝试现场重启并排队；都不行返回 false。 */
function dispatchCall(run: (a: CallActions) => void): boolean {
  const actions = actionsRegistry.get();
  if (actions) {
    run(actions);
    return true;
  }
  // 重启已在途（上一次点击排的队还没等到 actions）：这次点击顶替它（以最后一次为准），不再重复触发重启——
  // 否则连点两下会重建两次引擎，或者第一次的呼叫被悄悄丢掉却已经回了 true。
  if (pending && Date.now() - pending.at <= PENDING_TTL_MS) {
    pending = { run, at: Date.now() };
    return true;
  }
  if (!restartRequester || !restartRequester()) return false;
  pending = { run, at: Date.now() };
  return true;
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

/**
 * 确保 im-rtc 已登录（Kit 没登上时会先补一次取票登录，im-rtc 2.2.0）。宿主自己直接用引擎的地方
 * （通话记录 `fetchCallHistory`）先调它。Kit 还没挂好（actions 未注册）时返回 false。
 */
export async function ensureRtcReady(): Promise<boolean> {
  const actions = actionsRegistry.get();
  return actions === null ? false : actions.ensureReady();
}

/** 通话服务是否就绪。 */
export function rtcReady(): boolean {
  return actionsRegistry.get() !== null;
}

/** 单聊 1v1：`video=true` 视频，否则语音。就绪返回 true。 */
export function placeSingleCall(peerUid: string, video: boolean): boolean {
  return dispatchCall((actions) => { void actions.placeCall([peerUid], video ? "video" : "audio"); });
}

/** 群通话：类型固定 video（默认不开摄像头由 Kit 决定），chatGroupId = 群会话 id。 */
export function placeGroupCall(chatGroupId: string, calleeUids: string[]): boolean {
  return dispatchCall((actions) => {
    void actions.placeCall(calleeUids.slice(0, MAX_GROUP_CALL_PICK), "video", { isGroup: true, chatGroupId });
  });
}
