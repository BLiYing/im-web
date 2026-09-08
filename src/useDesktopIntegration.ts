// 桌面端集成：未读角标 / 系统通知 / 点通知打开会话。
//
// **这个文件里没有一处 `if (isDesktop)`**：能力分流在 `src/platform/`，浏览器版调同样的方法、
// 拿到 false 或空实现，于是行为不变（D1 的验收就是这句话）。判断逻辑在纯函数
// `src/desktopNotify.ts` 里，本文件只负责「什么时候调」以及订阅的生命周期。
import { useEffect, useRef, useState } from "react";
import { platform } from "./platform";
import { badgeCountOf, notifyBodyOf, shouldNotify } from "./desktopNotify";
import type { ChatMessage, Conversation } from "./sdk/protocol";
import type { DesktopCallbacks } from "./desktopWiring";

export interface DesktopIntegrationOptions {
  conversations: readonly Conversation[];
  selfUid: string;
  /** 当前打开的会话 id（正在看的不通知）。 */
  currentConvId: string;
}

export interface DesktopIntegration {
  /** 在 `onMessage` 里对每条**新追加**的入站消息调一次。 */
  notifyInbound: (m: ChatMessage) => void;
  /** 在 `convDisplayLabel`/`openChat` 声明处调一次，把两个回调递进来。
   *  **它们定义在登录早退之后，而 hook 必须在早退之前调**，故只能这样回写。 */
  bindCallbacks: (cb: DesktopCallbacks) => void;
  autoStart: boolean;
  autoStartSupported: boolean;
  setAutoStart: (on: boolean) => void;
}

export function useDesktopIntegration(opts: DesktopIntegrationOptions): DesktopIntegration {
  // 两个回调的实现要等 App 那边声明完才有（见 bindCallbacks 的说明），先占位。
  const cbRef = useRef<DesktopCallbacks>({ titleOf: () => "新消息", onOpenConversation: () => {} });
  // 用 ref 存易变值：订阅只装一次，回调里读最新的。
  // 直接把它们放进 useEffect 依赖会让「点通知打开会话」的订阅随每条消息重装一遍。
  const latest = useRef(opts);
  latest.current = opts;

  // ① 未读角标。只在**数字真的变了**时调：setBadge 是一次跨进程往返（异步，不阻塞渲染），
  //    但 conversations 的引用每次刷新都变，不去重就会为同一个数字反复打点。
  const badge = badgeCountOf(opts.conversations);
  const lastBadge = useRef<number | null>(null);
  useEffect(() => {
    if (lastBadge.current === badge) return;
    lastBadge.current = badge;
    void platform().setBadge(badge);   // 异步：不阻塞渲染，理由见 platform/types.ts
  }, [badge]);

  // ② 点系统通知 → 打开会话。**依赖 selfUid：换号要重装**——旧订阅留着的话，点一条上个账号
  //    时期的旧通知，convId 在新账号的会话表里找不到，`openConvById` 会回退到「从 conv_id 解析
  //    peer」，于是给新账号打开一个他未必有的对端会话（/code-review 2026-09-08）。
  //    这与 sdk/wake.ts 记的「不拆就跟着醒」同源：订阅的生命周期要跟着账号走。
  useEffect(() => {
    return platform().subscribeOpenConversation((convId) => {
      cbRef.current.onOpenConversation(convId);
    });
  }, [opts.selfUid]);

  const notifyInbound = (m: ChatMessage): void => {
    const o = latest.current;
    const conv = o.conversations.find((c) => c.conv_id === m.convId);
    // @我 / @全体 穿透免打扰：与微信 / Telegram 的惯例一致——设免打扰是「别为每条消息烦我」，
    // 不是「@我也别告诉我」。@全体也算，因为它通常就是「这条你必须看」。
    const mentionsMe = !!m.mentions?.includes(o.selfUid) || m.mentionAll === true;
    if (!shouldNotify(m, {
      selfUid: o.selfUid,
      currentConvId: o.currentConvId,
      // 现问，不缓存：窗口焦点随时在变，缓存下来必然有一段是错的。
      windowFocused: typeof document !== "undefined" && document.hasFocus(),
      muted: !!conv?.muted,
      mentionsMe,
    })) return;
    void platform().notify({ title: cbRef.current.titleOf(m.convId), body: notifyBodyOf(m), convId: m.convId });
  };

  // 开机自启。**读宿主的真实状态，而且不能只读一次**：用户可能刚去系统设置里手动改过，
  // 只在挂载时读的话开关会一直停在那一刻的值、与系统不符（/code-review 2026-09-08）。
  // 故挂载读一次 + **每次窗口重新获得焦点再读一次**——从系统设置切回来正好命中。
  const [autoStart, setAutoStartState] = useState(false);
  useEffect(() => {
    if (!platform().autoStartSupported()) return;
    let alive = true;
    const load = (): void => { void platform().getAutoStart().then((v) => { if (alive) setAutoStartState(v); }); };
    load();
    window.addEventListener("focus", load);
    return () => { alive = false; window.removeEventListener("focus", load); };
  }, []);

  return {
    notifyInbound,
    bindCallbacks: (cb) => { cbRef.current = cb; },
    autoStart,
    autoStartSupported: platform().autoStartSupported(),
    // 回填的是**设完读回来的实际值**：设失败（系统不允许）时开关会弹回去，而不是假装设上了。
    setAutoStart: (on) => { void platform().setAutoStart(on).then(setAutoStartState); },
  };
}
