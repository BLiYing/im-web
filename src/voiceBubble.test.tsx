// @vitest-environment jsdom
/**
 * VoiceBubble 的「时间 / 已读勾」契约。
 *
 * 背景：这一行曾在组件内自己算一套（peerReadSeq + 一个额外的 !isGroup），和 MessageList 给
 * 文本/媒体气泡用的 .bmeta 判定成了两份拷贝——群聊里 .bmeta 按 group_read_seq「全员已读」显双勾，
 * 语音却被 !isGroup 压成单勾。现在判定只有一个所有者（MessageList），气泡只负责显示传进来的结果。
 * 时分同理：必须走 time.ts 的 formatTime，跟随用户的 12/24 小时制设置。
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChatMessage } from "./sdk/protocol";
import { VoiceBubble, pauseVoicePlayback, voiceAudioElement } from "./components/VoiceBubble";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver;
});
afterEach(() => cleanup());

// 2026-01-02 09:05 本地时间——用本地构造，断言与时区无关。
const AT_9_05 = new Date(2026, 0, 2, 9, 5).getTime();

const voice = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  convId: "c1", from: "me", contentType: "voice", content: "/uploads/a.m4a",
  convSeq: 3, timestamp: AT_9_05, status: "sent", duration: 3000,
  ...over,
} as ChatMessage);

describe("VoiceBubble 已读勾：只认传入的 readByPeer", () => {
  it("readByPeer=true → 双勾（.voice-tick.read）", () => {
    render(<VoiceBubble m={voice()} mine uid="me" audioSrc="/uploads/a.m4a" readByPeer />);
    expect(document.querySelector(".voice-tick.read")).toBeInTheDocument();
    expect(document.querySelectorAll(".voice-tick.read svg path")).toHaveLength(2);
  });

  it("readByPeer=false → 单勾（.voice-tick 无 .read）", () => {
    render(<VoiceBubble m={voice()} mine uid="me" audioSrc="/uploads/a.m4a" readByPeer={false} />);
    expect(document.querySelector(".voice-tick")).toBeInTheDocument();
    expect(document.querySelector(".voice-tick.read")).not.toBeInTheDocument();
  });

  it("对方发的消息不显勾", () => {
    render(<VoiceBubble m={voice({ from: "peer" })} mine={false} uid="me" audioSrc="/uploads/a.m4a" readByPeer />);
    expect(document.querySelector(".voice-tick")).not.toBeInTheDocument();
  });
});

describe("VoiceBubble 时间行：走 formatTime，跟随 12/24 小时制", () => {
  it("24 小时制补零显 09:05（曾手写 getHours() 显成 9:05）", () => {
    render(<VoiceBubble m={voice()} mine uid="me" audioSrc="/uploads/a.m4a" timeFormat="24" />);
    expect(document.querySelector(".voice-time-row")!.textContent).toContain("09:05");
  });

  it("12 小时制显 9:05 AM（曾无视该设置）", () => {
    render(<VoiceBubble m={voice()} mine uid="me" audioSrc="/uploads/a.m4a" timeFormat="12" />);
    expect(document.querySelector(".voice-time-row")!.textContent).toContain("9:05 AM");
  });

  it("mini 变体（收藏/资料页）不出时间行——外层行本就有时间戳", () => {
    render(<VoiceBubble m={voice()} mine uid="me" audioSrc="/uploads/a.m4a" variant="mini" />);
    expect(document.querySelector(".voice-time-row")).not.toBeInTheDocument();
  });
});

// 语音**跟着页面走**：离开这条语音所属的那一页要暂停（切会话 / 关资料卡片 / 关收藏弹窗）。
// 单例 audio 挂在模块上，页面一关组件就卸载了、声音还在放，用户找不到任何暂停按钮
// （2026-09-05 用户反馈）。App 侧用三条 effect cleanup 触发，这里钉住被调用的那个函数本身。
describe("pauseVoicePlayback：离页暂停", () => {
  it("正在播 → 暂停，且**保留位点**（不是从头开始）", async () => {
    const el = voiceAudioElement();
    // jsdom 不实现 play()/媒体加载：直接摆出"正在播"的状态即可——本函数关心的只有 paused 与 currentTime。
    Object.defineProperty(el, "paused", { value: false, configurable: true });
    let paused = false;
    el.pause = () => { paused = true; Object.defineProperty(el, "paused", { value: true, configurable: true }); };
    el.currentTime = 1.5;
    pauseVoicePlayback();
    expect(paused).toBe(true);
    expect(el.currentTime).toBe(1.5); // stop 才复位，pause 不动位点
  });

  it("本来就没在播 → no-op（不白发一次通知）", () => {
    const el = voiceAudioElement();
    Object.defineProperty(el, "paused", { value: true, configurable: true });
    let called = false;
    el.pause = () => { called = true; };
    pauseVoicePlayback();
    expect(called).toBe(false);
  });
});
