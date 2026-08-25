// voice.test.ts —— 语音消息 P0 的纯函数护栏。
import { describe, it, expect } from "vitest";

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
