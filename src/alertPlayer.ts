// 通知提示音的实际播放（NOTIFICATIONS_DESIGN §3.2 Web/桌面行）。**纯浏览器 API，与 React 无关**——
// `alertDecision` 只决定「该不该响、响哪个」，这里负责「真的把声音放出来」。
//
// 每个音效一个预加载的 `HTMLAudioElement`（Web Audio 对这种「偶发短音」没必要，`<audio>` 更省心），
// ogg（Opus）优先、`canPlayType` 探测不支持时退回 mp3（Safari 桌面）。`none` 不产出任何元素。
//
// **两条播放入口**：`playAlertSound` 走 1.5 秒节流（防御性的第二道闸——`alertDecision` 已经按
// `lastSoundAtMs` 判过一次，调用方按它的结果决定要不要调这里；这里再挡一道是防未来有别的调用点
// 跳过 alertDecision 直接调用）；`previewAlertSound`（面板试听/音量滑杆松手）**不节流**，
// 用户主动操作要立即反馈。
//
// 自动播放失败（浏览器策略要求先有用户交互）**吞掉不抛**，记一条 warn 日志——这是预期路径，
// 不是 bug，只是没法在这里区分"策略拦截"与"文件 404"，都归一处理。
import { LOG_TAG, logger } from "./logging/logger";
import { NOTIFY_SOUND_IDS, type NotifySoundId } from "./notifySettings";

const PLAYABLE_IDS = NOTIFY_SOUND_IDS.filter((id) => id !== "none") as readonly Exclude<NotifySoundId, "none">[];

function soundUrl(id: string, ext: "ogg" | "mp3"): string {
  return `/sounds/notif_${id}.${ext}`;
}

/** ogg 支持探测：`canPlayType` 在不支持/未知时可能回 ""（含 jsdom 测试环境），一律当不支持处理、退回 mp3。 */
function pickSrc(id: string): string {
  const probe = document.createElement("audio");
  const can = probe.canPlayType('audio/ogg; codecs="opus"');
  return can === "probably" || can === "maybe" ? soundUrl(id, "ogg") : soundUrl(id, "mp3");
}

const cache = new Map<string, HTMLAudioElement>();

function elementFor(id: NotifySoundId): HTMLAudioElement | null {
  if (id === "none") return null;
  let el = cache.get(id);
  if (!el) {
    el = new Audio(pickSrc(id));
    el.preload = "auto";
    cache.set(id, el);
  }
  return el;
}

function clampVolume(volume0to10: number): number {
  return Math.min(1, Math.max(0, volume0to10 / 10));
}

/** 真放一次；同步/异步两种失败都吞（jsdom 的 `play()` 是同步抛，真浏览器的自动播放拦截是拒绝 Promise）。 */
function tryPlay(el: HTMLAudioElement, volume0to10: number, id: string, event: string): void {
  el.volume = clampVolume(volume0to10);
  el.currentTime = 0;
  try {
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.catch((error: unknown) => logger.warn(LOG_TAG.app, event, { id, error: String(error) }));
    }
  } catch (error) {
    logger.warn(LOG_TAG.app, event, { id, error: String(error) });
  }
}

let lastPlayedAtMs = 0;

/** 供通知链路调用：`alertDecision` 已判过节流/开关，这里只再挡一道 1.5 秒防御性节流。 */
export function playAlertSound(id: NotifySoundId, volume0to10: number): void {
  const el = elementFor(id);
  if (!el) return;
  const now = Date.now();
  const sinceLast = now - lastPlayedAtMs;
  if (sinceLast >= 0 && sinceLast < 1500) return; // 负值 = 时钟往回拨过，同 alertDecision
  lastPlayedAtMs = now;
  tryPlay(el, volume0to10, id, "alert_sound_play_failed");
}

/** 供设置面板调用：选提示音 / 拖动音量滑杆松手时的即时试听，**不节流**。 */
export function previewAlertSound(id: NotifySoundId, volume0to10: number): void {
  const el = elementFor(id);
  if (!el) return;
  tryPlay(el, volume0to10, id, "alert_sound_preview_failed");
}

/** 仅供测试：清掉节流与缓存，让下次播放不受上一个用例影响。生产代码不要调。 */
export function resetAlertPlayerForTests(): void {
  lastPlayedAtMs = 0;
  cache.clear();
}

export { PLAYABLE_IDS };
