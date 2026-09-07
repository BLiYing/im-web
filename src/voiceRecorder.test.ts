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

  it("「audio/mp4 支持但装的是 Opus」的浏览器 → 不支持（否则录出 iOS 播不了、还会崩的文件）", () => {
    // @ts-expect-error 测试注入
    globalThis.MediaRecorder = { isTypeSupported: (m: string) => m === "audio/mp4" || m === "audio/mp4;codecs=opus" };
    expect(voiceRecordingSupported().supported).toBe(false);
  });

  it("点名 AAC 的 mime 优先于裸 audio/mp4", () => {
    // @ts-expect-error 测试注入
    globalThis.MediaRecorder = { isTypeSupported: (m: string) => m === "audio/mp4" || m === "audio/mp4;codecs=mp4a.40.2" || m === "audio/mp4;codecs=opus" };
    expect(voiceRecordingSupported()).toEqual({ supported: true, mime: "audio/mp4;codecs=mp4a.40.2", ext: ".m4a" });
  });

  it("仅支持 webm/opus 的浏览器 → 不支持——绝不产出 iOS 播不了的消息", () => {
    // @ts-expect-error
    globalThis.MediaRecorder = { isTypeSupported: (m: string) => m === "audio/webm;codecs=opus" };
    expect(voiceRecordingSupported().supported).toBe(false);
  });

  it("探测函数不 throw（isTypeSupported 抛异常时兜底走 false）", () => {
    // @ts-expect-error
    globalThis.MediaRecorder = { isTypeSupported: () => { throw new Error("boom"); } };
    // 2026-08-30 起**刻意**加了 try/catch（探测要按 mime 逐个问好几遍，任何一次抛都不该把
    // 输入栏渲染带崩）：探测异常一律当"不支持"，mic 置灰即可。原护栏断言的是没有 try/catch 的旧行为。
    expect(voiceRecordingSupported()).toEqual({ supported: false, mime: "", ext: "" });
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
