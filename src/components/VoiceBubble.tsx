// VoiceBubble：语音气泡（voice P0，Web 只播不录，见 IMServer docs/design/VOICE_MESSAGE_DESIGN.md §10）。
// 结构：[▶/⏸] [ 波形 (进度扫过部分变蓝) ] [ m:ss + 未播红点 ]
// 波形来自协议 waveform（base64，每字节 0~100 振幅）；空则退化等高条纹。
//
// 播放单例：本组件模块内维护一个 HTMLAudioElement，同页面一次只播一条；
// "已播过"集合走 localStorage per-uid+per-conv（与 iOS 同策略：不跨端）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../sdk/protocol";
import { voiceRelayMid } from "../voiceRelay";
import { formatTime, type TimeFormat } from "../time";

/// 波形柱数：按可绘制宽度动态定；这里按 ~5.5px pitch 估算，实际下采见组件内。
const WAVE_MIN_BARS = 20;
const WAVE_MAX_BARS = 48;

/** waveform base64 → 0~1 归一化数组；非法/空 → null（调用方退化等高条纹）。 */
function amplitudesFromBase64(b64?: string): number[] | null {
  if (!b64) return null;
  try {
    const bin = atob(b64);
    if (bin.length === 0) return null;
    const out = new Array<number>(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = Math.min(100, bin.charCodeAt(i)) / 100;
    }
    return out;
  } catch {
    return null;
  }
}

/** 已播集合：per-uid + per-conv 存 localStorage；set 5000 封顶按 FIFO 剔除。 */
const PLAYED_CAP = 5000;
function playedKey(uid: string, convId: string): string { return `im.voice.played.${uid || "anon"}.${convId || "na"}`; }
/**
 * 取整份"已播"集合（一次 getItem + 一次 JSON.parse）。
 * 供接力 resolver **在扫描前取一次**复用——曾对每个候选消息各调一次 hasPlayed，
 * 一段 N 条连续语音就是 N 次 parse（数组上限 5000 条 id），且全压在 ended 回调里。
 */
export function voicePlayedSet(uid: string, convId: string): ReadonlySet<string> {
  try { return new Set(JSON.parse(localStorage.getItem(playedKey(uid, convId)) || "[]") as string[]); }
  catch { return new Set(); }
}
function hasPlayed(uid: string, convId: string, mid: string): boolean {
  return !!mid && voicePlayedSet(uid, convId).has(mid);
}
function markPlayed(uid: string, convId: string, mid: string): void {
  if (!mid) return;
  try {
    const k = playedKey(uid, convId);
    const arr = JSON.parse(localStorage.getItem(k) || "[]") as string[];
    if (arr.includes(mid)) return;
    arr.push(mid);
    if (arr.length > PLAYED_CAP) arr.splice(0, arr.length - PLAYED_CAP);
    localStorage.setItem(k, JSON.stringify(arr));
  } catch { /* localStorage 满 / 隐私模式 - 忽略 */ }
}

/** 单例 audio + 订阅广播（换条即停旧）：跨 VoiceBubble 实例协同。 */
const audio = new Audio();
const listeners = new Set<() => void>();
let currentSrc = "";
function notify() { for (const fn of listeners) fn(); }
audio.addEventListener("timeupdate", notify);
audio.addEventListener("play", notify);
audio.addEventListener("pause", notify);

/** 接力连播（§6.4，对齐 iOS）：一条播完自动接同会话下一条未播语音，遇非语音消息即停。
 *  数据源由 MessageList 注入——模块级单例 audio 的 ended 回调拿不到 React 树里的消息列表。
 *  返回 null / 未注册 → 播完即停（与此前行为一致）。 */
export interface VoiceRelayNext { mid: string; src: string; convId: string; }
/** 入参是刚播完那条的**消息 id**而非 URL：同一条语音转发多次时 URL 相同，按 URL 定位会落到错的位置。 */
export type VoiceRelayResolver = (finishedMid: string) => VoiceRelayNext | null;
let relayResolver: VoiceRelayResolver | null = null;
let currentMid = "";
// 当前这条是不是**从聊天列表**点播的。resolver 全局只有一个（挂在聊天列表上），而收藏弹窗/资料页
// 语音 tab 用同一个单例 audio 播 mini 气泡——不设这道闸，从收藏播一条同会话的语音，播完会顺着聊天
// 列表接力念下去（用户还停在收藏弹窗里）。mini 一律不接力，播完即停。
let currentRelayable = false;
export function setVoiceRelayResolver(fn: VoiceRelayResolver | null): void { relayResolver = fn; }

audio.addEventListener("ended", () => {
  const finishedMid = currentMid;
  const relayable = currentRelayable;
  currentSrc = ""; currentMid = ""; currentRelayable = false;
  let next: VoiceRelayNext | null = null;
  try { next = relayable && relayResolver ? relayResolver(finishedMid) : null; } catch { next = null; }
  if (next) {
    audio.src = next.src;
    currentSrc = next.src; currentMid = next.mid; currentRelayable = true; // 接力仍在聊天列表内，可继续
    audio.currentTime = 0;
    audio.playbackRate = loadSpeed(next.convId); // 倍速是会话级偏好，接力沿用
    // 播不动（404/编解码失败）时复位到"无当前条"，否则整条会话卡在幽灵播放态。
    audio.play().catch(() => { currentSrc = ""; currentMid = ""; currentRelayable = false; notify(); });
  }
  notify();
});

interface VoiceBubbleProps {
  m: ChatMessage;
  mine: boolean;
  uid: string;
  /** 拼绝对 URL（同 App fullMediaURL：host + content）。 */
  audioSrc: string;
  /** 迷你形态（资料页/收藏行）：关气泡背景，仅留 ▶+波形+时长横排（sketch §10/§11）。 */
  variant?: "bubble" | "mini";
  /** 对端是否已读（波形下方显 ✓/✓✓，2026-08-27 拍板）。**由 MessageList 算好传入**——
   *  与 .bmeta 共用同一判定（群聊用 group_read_seq「全员已读」播种，见 App.openConversation），
   *  别在气泡里另算一套：曾多带一个 !isGroup 条件，把群里的全员已读 ✓✓ 压成 ✓。 */
  readByPeer?: boolean;
  /** 12/24 小时制（通用设置）；与其它气泡共用 time.ts 的 formatTime，勿手写时分。 */
  timeFormat?: TimeFormat;
}

/// 会话级倍速偏好（per convId，localStorage 持久，与 iOS 同策略）。
function speedKey(convId: string): string { return `im.voice.rate.${convId || "na"}`; }
function loadSpeed(convId: string): number {
  try { const s = Number(localStorage.getItem(speedKey(convId))); if (s === 1.5 || s === 2) return s; } catch { /* 隐私模式 */ }
  return 1;
}
function saveSpeed(convId: string, r: number): void {
  try { localStorage.setItem(speedKey(convId), String(r)); } catch { /* ignore */ }
}

/** [语音] m:ss 时长格式化——与后端 hub_voice.go formatVoiceDuration 同口径。 */
function fmt(ms: number): string {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoiceBubble({ m, mine, uid, audioSrc, variant = "bubble", readByPeer = false, timeFormat = "24" }: VoiceBubbleProps) {
  const [tick, setTick] = useState(0);
  const waveRef = useRef<HTMLDivElement | null>(null);
  const [barCount, setBarCount] = useState(28);
  const mid = voiceRelayMid(m); // 与接力选取同一份身份定义（voiceRelay.ts 唯一来源）
  const dur = m.duration || 0;
  const isCurrent = currentSrc && audioSrc && currentSrc === audioSrc;
  const playing = isCurrent && !audio.paused && !audio.ended;
  const progress = isCurrent && audio.duration > 0 ? audio.currentTime / audio.duration : 0;
  // 惰性初值：hasPlayed 要读 localStorage，只在首渲染求一次（曾每渲染都算，聊天页有几十个语音气泡）。
  const [played, setPlayed] = useState(() => mine || hasPlayed(uid, m.convId, mid));

  const wasCurrentRef = useRef(false);
  useEffect(() => {
    const fn = () => {
      // 只在"与本气泡相关"时才重渲：当前正是本条，或刚从本条切走（需一次刷新复位 UI）。
      // 曾无条件 setTick——聊天列表+详情语音 tab+收藏弹窗同开时，播任何一条都以 ~4Hz 全量重渲全部实例。
      const cur = !!audioSrc && currentSrc === audioSrc;
      if (cur || wasCurrentRef.current) { wasCurrentRef.current = cur; setTick((t) => t + 1); }
    };
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, [audioSrc]);

  // 成为"当前播放条"即记已播——手动点击与**接力自动切过来**两条路径统一在这里收口
  // （接力由模块级 ended 回调驱动，切不到组件的 toggle）。markPlayed 幂等。
  useEffect(() => {
    if (isCurrent && !played && mid) { markPlayed(uid, m.convId, mid); setPlayed(true); }
  }, [isCurrent, played, mid, uid, m.convId]);

  useEffect(() => {
    const el = waveRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const n = Math.max(WAVE_MIN_BARS, Math.min(WAVE_MAX_BARS, Math.floor((w + 2.5) / 5.5)));
      setBarCount(n);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 解码/下采 memo 化：每次进度 tick 重渲不再重复 atob+逐字节循环（下采按 bucket 取最大值保峰形，与后端一致）。
  const amps = useMemo(() => amplitudesFromBase64(m.waveform), [m.waveform]);
  const N = barCount;
  const bars = useMemo(() => {
    const out: number[] = new Array<number>(N);
    for (let i = 0; i < N; i++) {
      if (!amps || amps.length === 0) { out[i] = 0.35; continue; }
      const lo = Math.floor((i * amps.length) / N);
      const hi = Math.max(lo + 1, Math.floor(((i + 1) * amps.length) / N));
      let v = 0;
      for (let j = lo; j < Math.min(amps.length, hi); j++) { if (amps[j] > v) v = amps[j]; }
      out[i] = v;
    }
    return out;
  }, [amps, N]);

  const activeCount = Math.round(progress * N);

  function toggle() {
    if (!audioSrc) return;
    if (isCurrent) {
      if (audio.paused) audio.play().catch(() => undefined);
      else audio.pause();
      return;
    }
    audio.pause();
    audio.src = audioSrc;
    currentSrc = audioSrc;
    currentMid = mid; // 接力定位用（见 VoiceRelayResolver：按消息 id 而非 URL）
    currentRelayable = variant === "bubble"; // 只有聊天列表里的气泡参与接力，mini（收藏/资料页）播完即停
    audio.currentTime = 0;
    audio.playbackRate = loadSpeed(m.convId); // 应用会话级倍速
    audio.play().catch(() => undefined);
    notify(); // 记"已播"由 isCurrent 的 effect 统一收口（手动点击与接力自动切换同一条路径）
  }

  /** scrub 拖拽：>=4pt 阈值避免与列表滚动打架；用 pointerdown/move/up 支持鼠标+触摸。 */
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubHint, setScrubHint] = useState<{ x: number; text: string } | null>(null);
  function onWavePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isCurrent || audio.duration <= 0) return;
    const el = waveRef.current; if (!el) return;
    el.setPointerCapture(e.pointerId);
    setScrubbing(true);
    updateScrub(e);
  }
  function updateScrub(e: React.PointerEvent<HTMLDivElement>) {
    if (!isCurrent) return;
    const el = waveRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = p * audio.duration;
    setScrubHint({ x: e.clientX - rect.left, text: `${fmt(p * dur)} / ${fmt(dur)}` });
    notify();
  }
  function endScrub(e: React.PointerEvent<HTMLDivElement>) {
    if (!scrubbing) return;
    const el = waveRef.current; if (el) { try { el.releasePointerCapture(e.pointerId); } catch { /* not captured */ } }
    setScrubbing(false);
    setScrubHint(null);
  }

  /** 倍速胶囊：1x → 1.5x → 2x → 1x 循环，会话级记忆。 */
  const [speed, setSpeed] = useState(loadSpeed(m.convId));
  function cycleSpeed() {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next); saveSpeed(m.convId, next);
    if (isCurrent) audio.playbackRate = next;
  }

  // 气泡宽度按 duration 线性延展（限 168~280px；tokens 与 iOS 一致 min(96+dur*3.6, 240)，Web 略宽 to fit menu）。
  const s = Math.max(1, Math.floor((dur || 1000) / 1000));
  const width = Math.max(168, Math.min(280, 116 + s * 3.6));

  const remaining = isCurrent ? Math.max(0, dur - Math.round(audio.currentTime * 1000)) : dur;
  const durLabel = playing || (isCurrent && audio.currentTime > 0) ? fmt(remaining) : fmt(dur);

  void tick; // 订阅音频事件后强制重绘

  // 消息时间/勾（2026-08-27 用户拍板：**独立一行**右对齐，iOS/Web 拉齐；时长行只留时长+倍速）。
  // mini 变体（收藏/详情页语音 tab）不显时间行——外层行本就有独立时间戳，重复即噪音。
  const timeStr = variant === "mini" ? "" : formatTime(m.timestamp, timeFormat);
  const showsTicks = variant !== "mini" && mine && m.convSeq > 0 && m.status !== "sending" && m.status !== "failed";

  return (
    <div className={`voice-bubble${variant === "mini" ? " variant-mini" : ""}`}
         style={variant === "mini" ? undefined : { width }}
         onClick={toggle} role="button">
      {/* 播放器行：▶ 与「波形 + 时长行」垂直居中。时间行在这一行**之外**——
          曾放进 .voice-center 里，把居中轴往下拽，视觉上 ▶ 比波形低一截（2026-08-27 修）。 */}
      <div className="voice-player-row">
      <button className={`voice-play${mine ? " mine" : ""}`}
              type="button"
              aria-label={playing ? "暂停" : "播放"}
              onClick={(e) => { e.stopPropagation(); toggle(); }}>
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="voice-center">
        <div className={`voice-wave${scrubbing ? " scrubbing" : ""}`}
             ref={waveRef}
             style={{ position: "relative", touchAction: "none" }}
             onPointerDown={(e) => { e.stopPropagation(); onWavePointerDown(e); }}
             onPointerMove={(e) => { if (scrubbing) { e.stopPropagation(); updateScrub(e); } }}
             onPointerUp={endScrub}
             onPointerCancel={endScrub}>
          {bars.map((v, i) => (
            <span key={i} className={i < activeCount ? "on" : undefined}
                  style={{ height: `${Math.max(3, v * 22)}px` }} />
          ))}
          {scrubHint && (
            <span className="voice-scrub-tip" style={{ left: `${scrubHint.x}px` }}>{scrubHint.text}</span>
          )}
        </div>
        <div className="voice-meta-row">
          {!played && !isCurrent && <span className="voice-unplayed" aria-label="未播放" />}
          <span className="voice-meta-text">{durLabel}</span>
          {isCurrent ? (
            <button className={`voice-speed${mine ? " mine" : ""}`}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); cycleSpeed(); }}>
              {speed === 1.5 ? "1.5x" : speed === 2 ? "2x" : "1x"}
            </button>
          ) : null}
        </div>
      </div>
      </div>
      {(timeStr || showsTicks) && (
        <div className="voice-time-row">
          <span className="voice-meta-text">
            {mine && m.status === "sending" ? "发送中…"
              : mine && m.status === "failed" ? "未发送 ✗"
              : timeStr}
            {showsTicks && (
              <span className={readByPeer ? "voice-tick read" : "voice-tick"}>{" "}{readByPeer ? "✓✓" : "✓"}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
