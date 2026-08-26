// voice.test.ts —— 语音消息 P0 的纯函数护栏。
import { describe, it, expect } from "vitest";
import { pickNextVoiceRelay, voiceRelayMid, type VoiceRelayMessage } from "./voiceRelay";

/** 与 App.tsx mediaPreview(voice) 同口径的辅助——护住"[语音] m:ss"格式不被改坏。 */
function voicePreview(durationMs: number): string {
  const s = Math.max(0, Math.floor((durationMs || 0) / 1000));
  return `[语音] ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

describe("voice preview localization", () => {
  it("12.4s → [语音] 0:12", () => {
    expect(voicePreview(12400)).toBe("[语音] 0:12");
  });
  it("60s → [语音] 1:00 (tabular zero-pad)", () => {
    expect(voicePreview(60000)).toBe("[语音] 1:00");
  });
  it("3:07 → [语音] 3:07", () => {
    expect(voicePreview(187000)).toBe("[语音] 3:07");
  });
  it("0 / 负值 → [语音] 0:00", () => {
    expect(voicePreview(0)).toBe("[语音] 0:00");
    expect(voicePreview(-500)).toBe("[语音] 0:00");
  });
  it("边界 900ms → [语音] 0:00（<1s 秒截断）", () => {
    expect(voicePreview(900)).toBe("[语音] 0:00");
  });
});

describe("waveform base64 decode", () => {
  // 与 VoiceBubble.amplitudesFromBase64 同口径：非法/空 → null，合法 → 0..1 数组。
  function amplitudesFromBase64(b64?: string): number[] | null {
    if (!b64) return null;
    try {
      const bin = atob(b64);
      if (bin.length === 0) return null;
      const out = new Array<number>(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = Math.min(100, bin.charCodeAt(i)) / 100;
      return out;
    } catch {
      return null;
    }
  }
  it("空 / undefined → null", () => {
    expect(amplitudesFromBase64(undefined)).toBeNull();
    expect(amplitudesFromBase64("")).toBeNull();
  });
  it("非法 base64 → null（不抛，退化等高条纹）", () => {
    expect(amplitudesFromBase64("!!!not-base64!!!")).toBeNull();
  });
  it("合法字节 → 0..1 数组", () => {
    // 0,50,100 → base64
    const b64 = btoa(String.fromCharCode(0, 50, 100));
    const arr = amplitudesFromBase64(b64);
    expect(arr).toEqual([0, 0.5, 1]);
  });
  it("字节 >100 会被 clamp 到 100（防脏数据显示满幅）", () => {
    const b64 = btoa(String.fromCharCode(200));
    expect(amplitudesFromBase64(b64)).toEqual([1]);
  });
});

// ---- 接力连播选取规则（§6.4，与 iOS im_relayAfterMessageID: 同口径） ----
describe("voice relay: pickNextVoiceRelay", () => {
  const ME = "me";
  const v = (id: string, from: string, extra: Partial<VoiceRelayMessage> = {}): VoiceRelayMessage =>
    ({ contentType: "voice", from, convId: "c1", serverMsgId: id, ...extra });
  const other = (from = "peer"): VoiceRelayMessage => ({ contentType: "text", from, convId: "c1", serverMsgId: "t" });
  const none = () => false;

  it("接同会话下一条对方未播语音", () => {
    const list = [v("a", "peer"), v("b", "peer")];
    expect(pickNextVoiceRelay(list, 0, ME, none)?.serverMsgId).toBe("b");
  });
  it("遇非语音消息即停（话题边界，不跨过文字继续念）", () => {
    const list = [v("a", "peer"), other(), v("c", "peer")];
    expect(pickNextVoiceRelay(list, 0, ME, none)).toBeNull();
  });
  it("自己发的跳过，继续往后找", () => {
    const list = [v("a", "peer"), v("b", ME), v("c", "peer")];
    expect(pickNextVoiceRelay(list, 0, ME, none)?.serverMsgId).toBe("c");
  });
  it("撤回的跳过但不算边界", () => {
    const list = [v("a", "peer"), v("b", "peer", { recalledAt: 123 }), v("c", "peer")];
    expect(pickNextVoiceRelay(list, 0, ME, none)?.serverMsgId).toBe("c");
  });
  it("已播过的跳过", () => {
    const list = [v("a", "peer"), v("b", "peer"), v("c", "peer")];
    const played = (_c: string, mid: string) => mid === "b";
    expect(pickNextVoiceRelay(list, 0, ME, played)?.serverMsgId).toBe("c");
  });
  it("末条播完 → null（不回头找）", () => {
    const list = [v("a", "peer"), v("b", "peer")];
    expect(pickNextVoiceRelay(list, 1, ME, none)).toBeNull();
  });
  it("finishedIdx=-1（找不到刚播完那条）→ null，不误接第 0 条", () => {
    const list = [v("a", "peer"), v("b", "peer")];
    expect(pickNextVoiceRelay(list, -1, ME, none)).toBeNull();
  });
  it("后面全是自己发的 → null", () => {
    const list = [v("a", "peer"), v("b", ME), v("c", ME)];
    expect(pickNextVoiceRelay(list, 0, ME, none)).toBeNull();
  });
  it("mid 取 serverMsgId 优先、回落 clientMsgId（入站消息无 clientMsgId）", () => {
    expect(voiceRelayMid({ contentType: "voice", from: "p", convId: "c1", serverMsgId: "s", clientMsgId: "c" })).toBe("s");
    expect(voiceRelayMid({ contentType: "voice", from: "p", convId: "c1", clientMsgId: "c" })).toBe("c");
    expect(voiceRelayMid({ contentType: "voice", from: "p", convId: "c1" })).toBe("");
  });
});
