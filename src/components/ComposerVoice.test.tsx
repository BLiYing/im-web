// @vitest-environment jsdom
/**
 * 录音条的两条用户实测（2026-09-05）：
 *   ① 暂停时没法预听——iOS 的锁定条早就有（+Voice.m §14 试听）。
 *   ② 在 A 会话录到一半切到 B，录音条跟着 B 显示，一按发送这段话就发给了 B。
 *
 * MediaRecorder / getUserMedia / AudioContext 在 jsdom 里都不存在，这里按**用得到的那部分**打桩：
 * 状态机（recording/paused/inactive）、timeslice 分片、requestData 强制吐片——录音条的行为全靠它们。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { Image as ImageIcon } from "lucide-react";
import { ChatActionsProvider, type ChatActions } from "../ChatActionsContext";
import { Composer, type ComposerProps } from "./Composer";

const MIME = "audio/mp4;codecs=mp4a.40.2";

/** 只实现录音条真正用到的那几个动作；chunk 内容用可辨认的字符串，便于断言"预听拿到的是已录的片段"。 */
class FakeMediaRecorder {
  static isTypeSupported = (m: string) => m === MIME;
  static last: FakeMediaRecorder | null = null;
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  emitted = 0;
  constructor(_s: unknown, _o: unknown) { FakeMediaRecorder.last = this; }
  start() { this.state = "recording"; }
  /** 模拟 timeslice 到点吐一片。 */
  emit(text: string) { this.emitted++; this.ondataavailable?.({ data: new Blob([text]) }); }
  requestData() { this.emit(`flush${this.emitted}`); }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.onstop?.(); }
}

class FakeAnalyser {
  fftSize = 1024;
  getByteTimeDomainData(buf: Uint8Array) { buf.fill(128); }
}

function installMediaShims() {
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
  });
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = class {
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return new FakeAnalyser(); }
    close() { return Promise.resolve(); }
  };
  URL.createObjectURL = vi.fn(() => "blob:preview") as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
}

const play = vi.fn(() => Promise.resolve());

function actions(over: Partial<ChatActions> = {}): ChatActions {
  return {
    setInput: vi.fn(), locateInChat: vi.fn(), jumpToBottom: vi.fn(), unblock: vi.fn(async () => {}),
    setEditingMsg: vi.fn(), setReplyTo: vi.fn(), exitSelectMode: vi.fn(), forwardSelected: vi.fn(),
    favoriteSelected: vi.fn(), deleteSelected: vi.fn(), removePastedImage: vi.fn(), cancelAttachClose: vi.fn(),
    scheduleAttachClose: vi.fn(), setAttachPanel: vi.fn(), pickFile: vi.fn(), openFavoritesPick: vi.fn(),
    onFilePicked: vi.fn(), setMentionFilter: vi.fn(), pickMention: vi.fn(), setMentionActive: vi.fn(),
    onInputChange: vi.fn(), onComposerPaste: vi.fn(), send: vi.fn(), setToast: vi.fn(),
    sendVoice: vi.fn(() => Promise.resolve()),
    attachAnchorRef: createRef<HTMLDivElement>(), fileInputRef: createRef<HTMLInputElement>(),
    mentionPanelRef: createRef<HTMLDivElement>(), mentionActiveRef: createRef<HTMLButtonElement>(),
    composerRef: createRef<HTMLTextAreaElement>(),
    ...over,
  } as unknown as ChatActions;
}

function base(over: Partial<ComposerProps> = {}): ComposerProps {
  return {
    convId: "c1", peer: "u2", uid: "u1", isGroupChat: false, peerLabel: "小明", peerBlocked: false,
    input: "", sendKey: "enter", composerMuteReason: null, showJump: false, jumpCount: 0,
    editingMsg: null, replyTo: null, selectMode: false, selected: new Set(),
    reportableSender: null, reportHasMine: false, pastedImages: [],
    attachPanel: false, attachItems: [{ id: "image", label: "图片或视频", accept: "image/*", icon: ImageIcon }],
    mentionQuery: null, mentionFilter: "", mentionRows: [], mentionActive: 0,
    mediaGate: () => undefined, senderLabel: (m) => m.from, onMentionNavKey: () => false,
    ...over,
  };
}

/** VoiceRecorder 用 performance.now() 算已录时长；不推进它，stopAndSend 会因 <0.6s 走 tooShort 丢弃。 */
let clock = 0;
beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  installMediaShims();
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement["play"];
  HTMLMediaElement.prototype.pause = vi.fn();
  play.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** 挂载 → 点麦克风开录 → 吐一片音频。返回 render 结果与 actions。 */
async function startRecording(p: ComposerProps = base()) {
  const a = actions();
  const r = render(<ChatActionsProvider value={a}><Composer {...p} /></ChatActionsProvider>);
  await act(async () => { fireEvent.click(r.getByTitle("点击开始录音")); });
  await waitFor(() => expect(document.querySelector(".voice-recorder-bar")).toBeTruthy());
  act(() => { FakeMediaRecorder.last!.emit("chunk0"); });
  clock += 3000; // 录了 3 秒（过了 0.6s 的 tooShort 门）
  return { ...r, a };
}

const rerenderWith = (r: { rerender: (ui: React.ReactElement) => void }, a: ChatActions, p: ComposerProps) =>
  act(() => { r.rerender(<ChatActionsProvider value={a}><Composer {...p} /></ChatActionsProvider>); });

describe("录音条：暂停后可预听", () => {
  it("录制中不给预听按钮；暂停后才出现，点它播放已录到的部分", async () => {
    const r = await startRecording();
    expect(r.queryByText("预听")).toBeNull(); // 录制中片段随时被续上，边录边听没有意义

    fireEvent.click(r.getByText("暂停"));
    expect(r.getByText("预听")).toBeTruthy();

    fireEvent.click(r.getByText("预听"));
    expect(play).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(r.getByText("停止")).toBeTruthy(); // 再点即停
  });

  // 不催一次 requestData 的话，最后不足一个 timeslice（500ms）的音频还压在内部缓冲里，
  // 预听就缺一小截——"我说完才按的暂停，怎么最后半句没了"。
  it("暂停时强制吐一次片，预听里带上最后那不足一片的音频", async () => {
    const r = await startRecording();
    const before = FakeMediaRecorder.last!.emitted;
    fireEvent.click(r.getByText("暂停"));
    expect(FakeMediaRecorder.last!.emitted).toBe(before + 1);
  });

  it("点「继续」录制 → 预听停下（不能一边录一边响）", async () => {
    const r = await startRecording();
    fireEvent.click(r.getByText("暂停"));
    fireEvent.click(r.getByText("预听"));
    expect(r.getByText("停止")).toBeTruthy();
    fireEvent.click(r.getByText("继续"));
    expect(r.queryByText("停止")).toBeNull();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
});

describe("录音条跟着录音所属的会话走", () => {
  it("切到别的会话：录音条收起 + 录音暂停；切回来还在", async () => {
    const r = await startRecording();
    expect(FakeMediaRecorder.last!.state).toBe("recording");

    await rerenderWith(r, r.a, base({ convId: "c2", peer: "u3" }));
    expect(document.querySelector(".voice-recorder-bar")).toBeNull();
    expect(FakeMediaRecorder.last!.state).toBe("paused"); // 暂停留底，不是丢弃

    await rerenderWith(r, r.a, base({ convId: "c1", peer: "u2" }));
    expect(document.querySelector(".voice-recorder-bar")).toBeTruthy();
  });

  // 这条是本次的核心：录音条是长驻组件，发送时若拿"当前会话"，这段话就发给了 B。
  it("回到原会话发送 → sendVoice 收到的是**录音所属**的会话", async () => {
    const r = await startRecording();
    await rerenderWith(r, r.a, base({ convId: "c2", peer: "u3" }));
    await rerenderWith(r, r.a, base({ convId: "c1", peer: "u2" }));

    act(() => { fireEvent.click(r.getByText("发送")); });
    await waitFor(() => expect(r.a.sendVoice).toHaveBeenCalled());
    const args = (r.a.sendVoice as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[4]).toBe("c1");
  });

  it("人在别的会话时，Enter/Esc 快捷键不再接管（否则一按就把这段发错人）", async () => {
    const r = await startRecording();
    await rerenderWith(r, r.a, base({ convId: "c2", peer: "u3" }));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(r.a.sendVoice).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.last!.state).toBe("paused"); // 也没被 Esc 之类误取消
  });
});
