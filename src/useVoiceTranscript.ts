// 语音「转文字」（服务端识别，见 IMServer docs/design/VOICE_TRANSCRIBE_DESIGN.md）在 Web 端的那一簇：
// 展开态表（convSeq → 文本，空串=识别中）+ 发起/收起 + WS 结果落地 + **撑高后把文字补进视口**。
//
// 从 App.tsx 抽出（CODING_STYLE §7 ①：transcripts 这份 state 只被这一族读写，外部只当值渲染）。
// 判据留成纯函数：滚动几何在 jsdom 里恒为 0，逻辑写在组件里就没法测。
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { ChatMessage } from "./sdk/protocol";
import { errorCode } from "./qr";

/** convSeq→文本 表的两个通用改法：删一项 / 仅当该项仍展开时写入。 */
const omitSeq = (r: Record<number, string>, seq: number): Record<number, string> => {
  const n = { ...r }; delete n[seq]; return n;
};
const setIfOpen = (r: Record<number, string>, seq: number, text: string): Record<number, string> =>
  (r[seq] === undefined ? r : { ...r, [seq]: text }); // 未展开（用户已取消）就别把面板又拉回来

/**
 * 两次转写态之间**高度变过**的消息 conv_seq。
 *
 * 三种都算：新展开（undefined → "识别中…"/文本）、识别结果到达（"" → 文本）、文本被改写。
 * **收起（有 → 无）不算**：面板消失只会让内容变矮，视口里的东西只多不少，不必也不该滚。
 */
export function changedTranscriptSeqs(
  prev: Readonly<Record<number, string>>,
  next: Readonly<Record<number, string>>,
): number[] {
  const out: number[] = [];
  for (const k of Object.keys(next)) {
    const seq = Number(k);
    if (prev[seq] !== next[seq]) out.push(seq);
  }
  return out;
}

/** 一维区间（容器/行在同一坐标系下的上下沿，单位 px）。 */
export interface Span { top: number; bottom: number }

/**
 * 让 `row` 完整落进 `box` 所需的 scrollTop 增量。
 *
 * - 已完整可见 → 0（**不做任何滚动**：用户在历史里转写一条中间的消息，不该被拽走）；
 * - 底部露在外面 → 只向下补到刚好露全；
 * - 行本身比视口还高（长转写文本）→ 最多补到"行顶对齐容器顶"，否则会把开头顶出去。
 */
export function revealDelta(row: Span, box: Span): number {
  const below = row.bottom - box.bottom;
  if (below <= 0) return 0;
  return Math.min(below, Math.max(0, row.top - box.top));
}

export interface VoiceTranscriptDeps {
  clientRef: RefObject<IMClient | null>;
  setToast: (s: string) => void;
  setMenu: (v: null) => void;
  /** 消息滚动容器（`.msgs`）。 */
  boxRef: RefObject<HTMLElement | null>;
}

export function useVoiceTranscript({ clientRef, setToast, setMenu, boxRef }: VoiceTranscriptDeps) {
  // convSeq -> 转写文本。空串 = 识别中；未定义 = 未展开。与 App 的 translations 分开：
  // 翻译是文本消息的译文，转写是语音的文字，同一条上两者可同时存在。
  const [transcripts, setTranscripts] = useState<Record<number, string>>({});
  const transcriptsRef = useRef<Record<number, string>>({}); // 稳定回调里读当前展开态
  transcriptsRef.current = transcripts;

  /**
   * 已展开 → 收起（**只收本地面板，不删服务端结果**：服务端按音频内容缓存、会话内共享，
   * 一个人"取消"不该把别人也能看到的结果删掉）。
   * 未展开 → 请求：命中缓存立刻出文本；否则先显"识别中…"，结果经 WS voice_transcript 帧到达。
   */
  const transcribeMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    if (m.convSeq <= 0) return;
    if (transcriptsRef.current[m.convSeq] !== undefined) { // 已展开 → 只收面板，不发请求
      setTranscripts((prev) => omitSeq(prev, m.convSeq));
      return;
    }
    setTranscripts((prev) => ({ ...prev, [m.convSeq]: "" })); // 空串=识别中
    void (async () => {
      try {
        const r = await clientRef.current?.transcribeVoice(m.convId, m.convSeq);
        if (r && r.status === "done" && r.text) setTranscripts((prev) => setIfOpen(prev, m.convSeq, r.text));
        // pending：维持"识别中…"，等 WS 帧。
      } catch (e) {
        // 业务码文案统一在 FRIENDLY_MESSAGES（api() 已据码本地化 message）；只有非业务错误
        // （网络/解析）才补前缀，否则会吐出裸的 "Failed to fetch"。
        const msg = (e as Error).message;
        setToast(errorCode(e) ? msg : `转文字失败：${msg}`);
        setTranscripts((prev) => omitSeq(prev, m.convSeq));
      }
    })();
  }, [clientRef, setMenu, setToast]);

  /** WS `voice_transcript` 帧落地。只在该条仍处于展开态时写文本——用户可能在等结果期间点了「取消转文字」。 */
  const applyRemoteTranscript = useCallback((convSeq: number, status: string, text: string) => {
    if (status === "done" && text) {
      setTranscripts((prev) => setIfOpen(prev, convSeq, text));
    } else if (status === "failed") {
      setToast("识别失败，请稍后重试");
      setTranscripts((prev) => (prev[convSeq] === undefined ? prev : omitSeq(prev, convSeq)));
    }
  }, [setToast]);

  // 面板长出来之后补一次可见性（用户 2026-09-05 实测：末条是语音时，转出来的文字整段挂在视口
  // 下沿之外，必须手动再滑一下才看得见）。**必须是 layout effect**：面板是这一帧才挂上的，
  // 消息条数与渲染窗口签名都没变，App 里那个滚动 effect 这一轮根本不会重跑。
  const prevRef = useRef<Record<number, string>>({});
  useLayoutEffect(() => {
    const changed = changedTranscriptSeqs(prevRef.current, transcripts);
    prevRef.current = transcripts;
    const box = boxRef.current;
    if (!box || changed.length === 0) return;
    const row = box.querySelector<HTMLElement>(`.msg-item[data-seq="${changed[changed.length - 1]}"]`);
    if (!row) return; // 该条已不在渲染窗口里（转写结果姗姗来迟时会这样）
    box.scrollTop += revealDelta(row.getBoundingClientRect(), box.getBoundingClientRect());
  }, [transcripts, boxRef]);

  return { transcripts, transcribeMessage, applyRemoteTranscript };
}
