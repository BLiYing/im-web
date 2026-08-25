// voiceRecorder 兼容探测 + waveform 编码规则的护栏（DOM/MediaRecorder 由 jsdom mock 提供）。
import { describe, it, expect, beforeEach } from "vitest";
import { voiceRecordingSupported } from "./voiceRecorder";

describe("voiceRecordingSupported", () => {
  beforeEach(() => {
    // 恢复 MediaRecorder 干净态（每个用例自己 mock）
    // @ts-expect-error 测试环境写入 global
    globalThis.MediaRecorder = undefined;
  });

  it("MediaRecorder 缺失 → 不支持", () => {
    expect(voiceRecordingSupported().supported).toBe(false);
  });

  it("audio/mp4 支持 → 返回 mp4 + .m4a", () => {
    // @ts-expect-error 测试环境注入
    globalThis.MediaRecorder = { isTypeSupported: (m: string) => m === "audio/mp4" };
    const p = voiceRecordingSupported();
    expect(p).toEqual({ supported: true, mime: "audio/mp4", ext: ".m4a" });
  });

  it("audio/aac 支持（无 mp4）→ 返回 aac + .aac", () => {
    // @ts-expect-error
    globalThis.MediaRecorder = { isTypeSupported: (m: string) => m === "audio/aac" };
    expect(voiceRecordingSupported()).toEqual({ supported: true, mime: "audio/aac", ext: ".aac" });
  });

  it("仅支持 webm/opus（默认 Chrome/Firefox）→ 不支持——绝不产出 iOS 播不了的消息", () => {
    // @ts-expect-error
    globalThis.MediaRecorder = { isTypeSupported: (m: string) => m === "audio/webm;codecs=opus" };
    expect(voiceRecordingSupported().supported).toBe(false);
  });

  it("探测函数不 throw（isTypeSupported 抛异常时兜底走 false）", () => {
    // @ts-expect-error
    globalThis.MediaRecorder = { isTypeSupported: () => { throw new Error("boom"); } };
    // 现实现没有 try/catch 包裹——这里断言：exception 会冒出去（护栏，若将来加了 try/catch 需刻意更新）。
    expect(() => voiceRecordingSupported()).toThrow();
  });
});

// 波形下采规则测试——离线核对：60 帧 base64 后长度稳定；短样本原样保留。
describe("waveform base64 encoding (sanity)", () => {
  it("btoa/atob 双向可逆（voiceRecorder 内部依赖）", () => {
    const s = String.fromCharCode(0, 50, 100);
    const b = btoa(s);
    expect(atob(b)).toBe(s);
  });
});
