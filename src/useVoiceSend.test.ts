// @vitest-environment jsdom
// useVoiceSend：语音发送 + 上传失败重试回归。注入假 clientRef + 消息表三方法，断言编排顺序与副作用
// ——尤其是"上传失败必须留下可重发的占位"这条（2026-09-24 之前 Web 端完全没有，见文件顶部注释）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { fakeClientRef } from "./testing/fakeIMClient";
import { useVoiceSend, type VoiceSendDeps } from "./useVoiceSend";
import { resendPolicyFor } from "./resendPolicy";

afterEach(cleanup);

beforeEach(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:voice-${++n}`) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
});

function mount(over: Partial<{ uploadVoice: unknown; sendMedia: unknown }> = {}) {
  const client = {
    uploadVoice: vi.fn(async (b: Blob) => ({ url: "https://cdn/voice.m4a", size: b.size })),
    sendMedia: vi.fn(() => "cmid-1"),
    ...over,
  };
  const deps: VoiceSendDeps = {
    uid: "u1", convId: "u_u1_u_u2", clientRef: fakeClientRef(client),
    setToast: vi.fn(), appendMsg: vi.fn(), patchMsg: vi.fn(), removeMsgRow: vi.fn(),
  };
  return { ...renderHook(() => useVoiceSend(deps)), deps, client };
}

const blob = (size = 4) => new Blob([new Uint8Array(size)], { type: "audio/mp4" });

describe("useVoiceSend", () => {
  it("sendVoice：立即 appendMsg 占位(sending，content=本地 blobUrl) → 上传成功 → removeMsgRow 摘占位 + 换真实 cid/URL 重新上屏", async () => {
    const { result, deps, client } = mount();
    act(() => result.current.sendVoice(blob(8), "a.m4a", "d2F2ZQ==", 3000));
    // 占位先于上传结果同步上屏——录音条松手那一刻就该看到气泡，不必等网络。
    expect(deps.appendMsg).toHaveBeenCalledWith("u_u1_u_u2", expect.objectContaining({
      status: "sending", contentType: "voice", content: "blob:voice-1", duration: 3000, waveform: "d2F2ZQ==", fileSize: 8,
    }));
    await waitFor(() => expect(client.sendMedia).toHaveBeenCalled());
    expect(client.sendMedia).toHaveBeenCalledWith("https://cdn/voice.m4a", "voice", "u2", "u_u1_u_u2", expect.objectContaining({ duration: 3000, waveform: "d2F2ZQ==" }));
    expect(deps.removeMsgRow).toHaveBeenCalledWith("u_u1_u_u2", expect.stringMatching(/^outbox-voice-/));
    expect(deps.appendMsg).toHaveBeenLastCalledWith("u_u1_u_u2", expect.objectContaining({ clientMsgId: "cmid-1", content: "https://cdn/voice.m4a", status: "sending" }));
  });

  it("群聊目标：to 留空（服务端按 conv_id 写扩散）", async () => {
    const client = { uploadVoice: vi.fn(async (b: Blob) => ({ url: "https://cdn/voice.m4a", size: b.size })), sendMedia: vi.fn(() => "cmid-1") };
    const deps: VoiceSendDeps = {
      uid: "u1", convId: "g_1", clientRef: fakeClientRef(client),
      setToast: vi.fn(), appendMsg: vi.fn(), patchMsg: vi.fn(), removeMsgRow: vi.fn(),
    };
    const { result } = renderHook(() => useVoiceSend(deps));
    act(() => result.current.sendVoice(blob(), "a.m4a", "", 1000));
    await waitFor(() => expect(client.sendMedia).toHaveBeenCalled());
    expect(client.sendMedia).toHaveBeenCalledWith(expect.any(String), "voice", "", "g_1", expect.anything());
  });

  it("上传失败：占位原地转 failed 且保留本地 blobUrl（红❗可点）+ toast；resendPolicyFor 判定仍是 retry-upload（不受 note 影响）", async () => {
    const { result, deps } = mount({ uploadVoice: vi.fn(async () => { throw new Error("网络错误"); }) });
    act(() => result.current.sendVoice(blob(), "a.m4a", "", 1000));
    await waitFor(() => expect(deps.patchMsg).toHaveBeenCalled());
    expect(deps.patchMsg).toHaveBeenCalledWith("u_u1_u_u2", expect.stringMatching(/^outbox-voice-/), { status: "failed", note: "网络错误" });
    expect(deps.setToast).toHaveBeenCalledWith("网络错误");
    // 与旧实现的核心区别：失败不再是"消失+toast"，气泡还在、可重发。
    const localId = (deps.patchMsg as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(resendPolicyFor({
      clientMsgId: localId, convId: "u_u1_u_u2", from: "u1", content: "blob:voice-1", contentType: "voice",
      convSeq: 0, timestamp: 1, status: "failed", note: "网络错误",
    }, true)).toBe("retry-upload");
  });

  it("retryVoiceUpload：无留存 Blob（如页面刷新过）→ toast 提示，不崩、不误删气泡", () => {
    const { result, deps } = mount();
    act(() => result.current.retryVoiceUpload({
      clientMsgId: "gone", convId: "u_u1_u_u2", from: "u1", content: "blob:x", contentType: "voice", convSeq: 0, timestamp: 1, status: "failed",
    }));
    expect(deps.setToast).toHaveBeenCalledWith("原始录音已丢失，请重新录制");
    expect(deps.removeMsgRow).not.toHaveBeenCalled();
  });

  it("retryVoiceUpload：用留存的 Blob 重新上传（不重录）——旧占位摘除、换新 clientMsgId、原样携带 waveform/duration", async () => {
    const { result, deps, client } = mount({ uploadVoice: vi.fn(async () => { throw new Error("超时"); }) });
    act(() => result.current.sendVoice(blob(6), "a.m4a", "d2F2ZQ==", 2500));
    await waitFor(() => expect(deps.patchMsg).toHaveBeenCalled());
    const localId = (deps.patchMsg as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    (client.uploadVoice as ReturnType<typeof vi.fn>).mockImplementation(async (b: Blob) => ({ url: "https://cdn/retried.m4a", size: b.size }));
    act(() => result.current.retryVoiceUpload({
      clientMsgId: localId, convId: "u_u1_u_u2", from: "u1", content: "blob:voice-1", contentType: "voice",
      duration: 2500, waveform: "d2F2ZQ==", convSeq: 0, timestamp: 1, status: "failed", note: "超时",
    }));
    expect(deps.removeMsgRow).toHaveBeenCalledWith("u_u1_u_u2", localId);
    await waitFor(() => expect(client.sendMedia).toHaveBeenCalledWith("https://cdn/retried.m4a", "voice", "u2", "u_u1_u_u2", expect.objectContaining({ duration: 2500, waveform: "d2F2ZQ==" })));
  });
});
