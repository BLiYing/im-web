// 桌面端集成：未读角标 / 系统通知 / 点通知打开会话。
//
// **这个文件里没有一处 `if (isDesktop)`**：能力分流在 `src/platform/`，浏览器版调同样的方法、
// 拿到 false 或空实现，于是行为不变（D1 的验收就是这句话）。判断逻辑在纯函数
// `src/desktopNotify.ts` 里，本文件只负责「什么时候调」以及订阅的生命周期。
import { useEffect, useRef, useState } from "react";
import { platform, type GlobalShortcutState } from "./platform";
import { badgeCountOf, notifyBodyOf } from "./desktopNotify";
import { notifyIconSource, withNotifyIcon } from "./notifyIcon";
import type { NotifyClearRequest } from "./platform";
import { alertDecision, type AlertContext } from "./alertDecision";
import { playAlertSound, preloadAlertSounds } from "./alertPlayer";
import { isMutedNow } from "./muteState";
import { CALL_CONTENT_TYPE, callRecordIsGroup, isMissedCall } from "./callRecord";
import { getCallEngine } from "./rtc/rtcCall";
import { t as i18nT } from "./i18n";
import type { ChatMessage, Conversation } from "./sdk/protocol";
import type { NotifySettings } from "./notifySettings";
import type { DesktopCallbacks } from "./desktopWiring";

export interface DesktopIntegrationOptions {
  conversations: readonly Conversation[];
  selfUid: string;
  /** 当前打开的会话 id（正在看的不通知）。 */
  currentConvId: string;
  /** 通知设置（NOTIFICATIONS_DESIGN §6）：私聊/群聊开关与预览、应用内声音、角标口径、桌面声音/音量。 */
  notifySettings: NotifySettings;
}

export interface DesktopIntegration {
  /** 转发 `platform().isDesktop`：调用方（NotificationsPanel 的「浏览器版占位」判断）
   *  不用再多 import 一次 `./platform`，省一处「我是不是桌面端」的问法（§7.3 ③精神一致）。 */
  isDesktop: boolean;
  /** 在 `onMessage` 里对每条**新追加**的入站消息调一次。 */
  notifyInbound: (m: ChatMessage) => void;
  /** 收回已弹的系统通知：消息被撤回 / 删除（`convSeqs`）、本人在别处读到了某处（`upTo`）。
   *  窗口回到前台的「全清」由桌面主进程自己做，不经这里。浏览器版空操作。 */
  clearNotifications: (req: NotifyClearRequest) => void;
  /** 在 `convDisplayLabel`/`openChat` 声明处调一次，把两个回调递进来。
   *  **它们定义在登录早退之后，而 hook 必须在早退之前调**，故只能这样回写。 */
  bindCallbacks: (cb: DesktopCallbacks) => void;
  autoStart: boolean;
  autoStartSupported: boolean;
  setAutoStart: (on: boolean) => void;
  /** 全局快捷键（默认关）。`enabled` 是真的注册上了，`taken` 表示想开但被别的应用占着。 */
  globalShortcut: GlobalShortcutState;
  globalShortcutSupported: boolean;
  setGlobalShortcut: (on: boolean) => void;
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
  //    includeMuted 来自通知设置 §3.4：默认 false = 现行口径，开了才把免打扰会话计进来。
  const badge = badgeCountOf(opts.conversations, opts.notifySettings.badge.includeMuted);
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

  // 提示音预热：选中的私聊/群聊提示音在页面还可见时就加载好，换了选择（本机改或别的设备同步过来）再补。
  // 后台标签页里临时创建的 Audio 会被 Chrome 挂起加载、第一声响不出来，理由见 alertPlayer.ts#preloadAlertSounds。
  const privateSound = opts.notifySettings.private.sound;
  const groupSound = opts.notifySettings.group.sound;
  useEffect(() => { preloadAlertSounds([privateSound, groupSound]); }, [privateSound, groupSound]);

  // 上次真的响了一声的时刻：`alertDecision` 的 1.5 秒节流要靠它（连发十条只响一声）。
  // 只在 `sound` 判为 true 时才推进——被节流/开关关掉/免打扰拦下的那些不算「响过」。
  const lastSoundAtRef = useRef(0);

  const notifyInbound = (m: ChatMessage): void => {
    if (!m.convId) return;   // 畸形消息：点了也不知道该开哪个会话
    const o = latest.current;
    const conv = o.conversations.find((c) => c.conv_id === m.convId);
    // @我 / @全体 穿透免打扰：与微信 / Telegram 的惯例一致——设免打扰是「别为每条消息烦我」，
    // 不是「@我也别告诉我」。@全体也算，因为它通常就是「这条你必须看」。
    const mentionsMe = !!m.mentions?.includes(o.selfUid) || m.mentionAll === true;
    const isCallRecord = m.contentType === CALL_CONTENT_TYPE;
    const missedCallForMe = isCallRecord
      && isMissedCall(m.content, { viewerIsSender: false, isGroup: callRecordIsGroup(m.content) });
    // 现问，不缓存：窗口焦点随时在变，缓存下来必然有一段是错的。
    const windowFocused = typeof document !== "undefined" && document.hasFocus();
    // 通话中不响不振（会抢通话音频）：engine 未就绪（未登录/未配置）时当作没在通话。
    const callEngine = getCallEngine();
    const inCall = !!callEngine && callEngine.state.call.state !== "idle";
    const settings = o.notifySettings;
    const typeSettings = conv?.is_group ? settings.group : settings.private;
    const nowMs = Date.now();

    const ctx: AlertContext = {
      platform: platform().isDesktop ? "desktop" : "browser",
      isLive: true,   // 调用方（App onMessage）只在 live=true 时才调本函数，见那里的注释
      isSelf: m.from === o.selfUid,
      isSystem: m.contentType === "system",
      isRecalled: !!m.recalledAt,
      isCallRecord,
      missedCallForMe: !!missedCallForMe,
      convType: conv?.is_group ? "group" : "private",
      // 定时免打扰到期后按未免打扰算（NOTIFICATIONS_P1_DESIGN §4.3）：复用上面已算好的 nowMs，
      // 到期不需要额外请求——服务端同一时刻自然也按已过期返回。
      muted: isMutedNow(!!conv?.muted, conv?.mute_until, nowMs),
      mentionsMe,
      appActive: windowFocused,
      windowFocused,
      viewingConv: windowFocused && m.convId === o.currentConvId,
      inCall,
      nowMs,
      lastSoundAtMs: lastSoundAtRef.current,
      settings,
    };
    const d = alertDecision(ctx);

    if (d.sound && d.soundId) {
      lastSoundAtRef.current = nowMs;
      playAlertSound(d.soundId, settings.desktop.volume);
    }
    if (d.osNotify) {
      // 消息预览关闭时正文统一为「新消息」，标题（会话名/发送者名）不受影响（§3.3）。
      const body = typeSettings.preview ? notifyBodyOf(m) : i18nT("notif.preview.hidden");
      const title = cbRef.current.titleOf(m.convId);
      const convId = m.convId;
      // 头像：群聊=群头像、单聊=对端（notifyIcon.ts）；带上 convSeq，之后撤回 / 别处已读才收得回来。
      withNotifyIcon(notifyIconSource(conv, convId, title), (icon) => {
        void platform().notify({ title, body, convId, convSeq: m.convSeq, icon });
      });
    }
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

  // 全局快捷键。**只在挂载时读一次**：它只会被本应用自己改（设置页那个开关），不像开机自启
  // 会被用户跑去系统设置里改。label 在读到之前是空串，设置页据此先不渲染那一项。
  const [globalShortcut, setGlobalShortcutState] = useState<GlobalShortcutState>({ enabled: false, label: "" });
  useEffect(() => {
    if (!platform().globalShortcutSupported()) return;
    let alive = true;
    void platform().getGlobalShortcut().then((s) => { if (alive) setGlobalShortcutState(s); });
    return () => { alive = false; };
  }, []);

  return {
    isDesktop: platform().isDesktop,
    notifyInbound,
    clearNotifications: (req) => platform().clearNotifications(req),
    bindCallbacks: (cb) => { cbRef.current = cb; },
    autoStart,
    autoStartSupported: platform().autoStartSupported(),
    // 回填的是**设完读回来的实际值**：设失败（系统不允许）时开关会弹回去，而不是假装设上了。
    setAutoStart: (on) => { void platform().setAutoStart(on).then(setAutoStartState); },
    globalShortcut,
    globalShortcutSupported: platform().globalShortcutSupported(),
    // 同上：回填读回来的真实状态。被占用时开关弹回去，并带着 taken 让设置页说明原因。
    setGlobalShortcut: (on) => { void platform().setGlobalShortcut(on).then(setGlobalShortcutState); },
  };
}
