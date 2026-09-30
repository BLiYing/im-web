// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { playAlertSound, preloadAlertSounds, previewAlertSound, resetAlertPlayerForTests } from "./alertPlayer";

let playSpy: ReturnType<typeof vi.spyOn>;
let canPlaySpy: ReturnType<typeof vi.spyOn>;
let playedSrcs: string[];
let playedVolumes: number[];

beforeEach(() => {
  resetAlertPlayerForTests();
  playedSrcs = [];
  playedVolumes = [];
  playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    playedSrcs.push(this.currentSrc || this.src);
    playedVolumes.push(this.volume);
    return Promise.resolve();
  });
  // jsdom 本身 canPlayType 恒回 ""；默认按「支持 ogg」布置，个别用例自己 override。
  canPlaySpy = vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
});

afterEach(() => {
  playSpy.mockRestore();
  canPlaySpy.mockRestore();
  vi.useRealTimers();
});

describe("playAlertSound", () => {
  it("none 不创建也不播放任何元素", () => {
    playAlertSound("none", 7);
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("正常 id：真的调用 play()，音量 = volume/10", () => {
    playAlertSound("default", 7);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(playedVolumes[0]).toBeCloseTo(0.7);
  });

  it("音量钳制到 0~1（0 与 10 两端）", () => {
    playAlertSound("chord", 0);
    expect(playedVolumes[0]).toBe(0);
    resetAlertPlayerForTests();
    playedVolumes = [];
    playAlertSound("chord", 10);
    expect(playedVolumes[0]).toBeCloseTo(1);
  });

  it("canPlayType 支持 ogg → 用 .ogg；不支持 → 退回 .mp3（Safari 桌面）", () => {
    playAlertSound("chime", 7);
    expect(playedSrcs[0]).toMatch(/notif_chime\.ogg$/);
    resetAlertPlayerForTests();
    playedSrcs = [];
    canPlaySpy.mockReturnValue("");
    playAlertSound("chime", 7);
    expect(playedSrcs[0]).toMatch(/notif_chime\.mp3$/);
  });

  it("1.5 秒内第二次调用被节流：只播一次；过了 1.5 秒再响", () => {
    vi.useFakeTimers();
    playAlertSound("rise", 7);
    playAlertSound("rise", 7); // 立刻又来一条：节流吞掉
    expect(playSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    playAlertSound("rise", 7);
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it("play() 同步抛出 / 异步拒绝都吞掉，不向上抛", async () => {
    playSpy.mockImplementation(() => { throw new Error("NotAllowedError"); });
    expect(() => playAlertSound("drop", 7)).not.toThrow();
    resetAlertPlayerForTests();
    playSpy.mockImplementation(() => Promise.reject(new Error("NotAllowedError")));
    expect(() => playAlertSound("drop", 7)).not.toThrow();
    await Promise.resolve(); // 让拒绝的 promise 有机会被 catch 处理，确认不产出 unhandledRejection
  });
});

describe("previewAlertSound：面板试听，不节流", () => {
  it("同一个 id 连续两次调用都真的播放（不像 playAlertSound 那样被节流吞掉第二次）", () => {
    previewAlertSound("default", 5);
    previewAlertSound("default", 5);
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it("none 不播放", () => {
    previewAlertSound("none", 5);
    expect(playSpy).not.toHaveBeenCalled();
  });
});

// Chrome 对「隐藏且从没加载过媒体」的页面会挂起媒体加载：元素必须在页面可见时就建好，
// 不能拖到第一条消息到达（那时标签页多半在后台）才 new。
describe("preloadAlertSounds：预热", () => {
  it("给定的 id 各建一个 preload=auto 的元素、不播放；none 跳过；之后播放复用同一个元素不再新建", () => {
    const created: HTMLAudioElement[] = [];
    const RealAudio = globalThis.Audio;
    const audioSpy = vi.spyOn(globalThis, "Audio").mockImplementation(function (src?: string) {
      const el = new RealAudio(src);
      created.push(el);
      return el;
    } as unknown as typeof Audio);
    try {
      preloadAlertSounds(["chord", "none", "chime"]);
      expect(created.map((el) => el.src.split("/").pop())).toEqual(["notif_chord.ogg", "notif_chime.ogg"]);
      expect(created.every((el) => el.preload === "auto")).toBe(true);
      expect(playSpy).not.toHaveBeenCalled();

      preloadAlertSounds(["chord"]);   // 已建过：不重复建
      playAlertSound("chord", 7);
      expect(created).toHaveLength(2);
      expect(playSpy.mock.contexts[0]).toBe(created[0]);
    } finally {
      audioSpy.mockRestore();
    }
  });
});
