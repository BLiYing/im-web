// @vitest-environment jsdom
/**
 * VoiceBubble 的「时间 / 已读勾」契约。
 *
 * 背景：这一行曾在组件内自己算一套（peerReadSeq + 一个额外的 !isGroup），和 MessageList 给
 * 文本/媒体气泡用的 .bmeta 判定成了两份拷贝——群聊里 .bmeta 按 group_read_seq「全员已读」显 ✓✓，
 * 语音却被 !isGroup 压成 ✓。现在判定只有一个所有者（MessageList），气泡只负责显示传进来的结果。
 * 时分同理：必须走 time.ts 的 formatTime，跟随用户的 12/24 小时制设置。
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChatMessage } from "./sdk/protocol";
import { VoiceBubble } from "./components/VoiceBubble";

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
  it("readByPeer=true → ✓✓（.voice-tick.read）", () => {
    render(<VoiceBubble m={voice()} mine uid="me" audioSrc="/uploads/a.m4a" readByPeer />);
    expect(document.querySelector(".voice-tick.read")).toBeInTheDocument();
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
