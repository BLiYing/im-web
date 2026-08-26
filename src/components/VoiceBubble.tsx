// VoiceBubble：语音气泡（voice P0，Web 只播不录，见 IMServer docs/VOICE_MESSAGE_DESIGN.md §10）。
// 结构：[▶/⏸] [ 波形 (进度扫过部分变蓝) ] [ m:ss + 未播红点 ]
// 波形来自协议 waveform（base64，每字节 0~100 振幅）；空则退化等高条纹。
//
// 播放单例：本组件模块内维护一个 HTMLAudioElement，同页面一次只播一条；
// "已播过"集合走 localStorage per-uid+per-conv（与 iOS 同策略：不跨端）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../sdk/protocol";

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
function hasPlayed(uid: string, convId: string, mid: string): boolean {
  if (!mid) return false;
  try { const arr = JSON.parse(localStorage.getItem(playedKey(uid, convId)) || "[]") as string[]; return arr.includes(mid); } catch { return false; }
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
audio.addEventListener("ended", () => { currentSrc = ""; notify(); });

interface VoiceBubbleProps {
  m: ChatMessage;
  mine: boolean;
  uid: string;
  /** 拼绝对 URL（同 App fullMediaURL：host + content）。 */
  audioSrc: string;
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

export function VoiceBubble({ m, mine, uid, audioSrc }: VoiceBubbleProps) {
  const [tick, setTick] = useState(0);
  const waveRef = useRef<HTMLDivElement | null>(null);
  const [barCount, setBarCount] = useState(28);
  const mid = m.serverMsgId || m.clientMsgId || "";
  const dur = m.duration || 0;
  const isCurrent = currentSrc && audioSrc && currentSrc === audioSrc;
  const playing = isCurrent && !audio.paused && !audio.ended;
  const progress = isCurrent && audio.duration > 0 ? audio.currentTime / audio.duration : 0;
  const initiallyPlayed = mine || hasPlayed(uid, m.convId, mid);
  const [played, setPlayed] = useState(initiallyPlayed);

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
    audio.currentTime = 0;
    audio.playbackRate = loadSpeed(m.convId); // 应用会话级倍速
    audio.play().catch(() => undefined);
    if (!played && mid) { markPlayed(uid, m.convId, mid); setPlayed(true); }
    notify();
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

  return (
    <div className="voice-bubble" style={{ width }} onClick={toggle} role="button">
      <button className={`voice-play${mine ? " mine" : ""}`}
              type="button"
              aria-label={playing ? "暂停" : "播放"}
              onClick={(e) => { e.stopPropagation(); toggle(); }}>
        {playing ? "❚❚" : "▶"}
      </button>
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
      <div className="voice-meta">
        {isCurrent ? (
          // 播放中：倍速胶囊代替时长（同一列/同一高度，气泡整体不再抖，2026-08-27 修）。
          <button className={`voice-speed${mine ? " mine" : ""}`}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); cycleSpeed(); }}>
            {speed === 1.5 ? "1.5x" : speed === 2 ? "2x" : "1x"}
          </button>
        ) : (
          <>
            {!played && <span className="voice-unplayed" aria-label="未播放" />}
            <span className="voice-dur">{durLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}
