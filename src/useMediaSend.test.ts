// @vitest-environment jsdom
// useMediaSend（阶段 5 抽出）的发送流水线/攒批/重试回归。注入假 clientRef + 消息表三方法，断言编排顺序与副作用。
import { describe, it, expect, vi, beforeEach , afterEach } from "vitest";
import { renderHook, act, waitFor , cleanup } from "@testing-library/react";
import { fakeClientRef } from "./testing/fakeIMClient";
import { useMediaSend, type MediaSendDeps } from "./useMediaSend";
afterEach(cleanup); // 多次 renderHook：卸载前一用例（CODING_STYLE §八）

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
});
function mount(over: Partial<{ uploadFile: unknown; sendMedia: unknown }> = {}) {
  const client = {
    uploadFile: vi.fn(async (f: File) => ({ url: `https://cdn/${f.name}`, contentType: "file", size: f.size })),
    sendMedia: vi.fn(() => "cmid-1"),
    ...over,
  };
  const deps: MediaSendDeps = {
    uid: "u1", peer: "u2", groupConvId: "", clientRef: fakeClientRef(client),
    setToast: vi.fn(), appendMsg: vi.fn(), patchMsg: vi.fn(), removeMsgRow: vi.fn(),
  };
  return { ...renderHook(() => useMediaSend(deps)), deps, client };
}
const file = (name: string, type = "application/octet-stream") => new File(["x"], name, { type });

describe("useMediaSend", () => {
  it("粘贴限单件：多件只保留最新一个，被替换的 toast 提示；removePastedImage 移除并 revoke", () => {
    const { result, deps } = mount();
    act(() => result.current.addPastedFiles([file("a.txt"), file("b.txt")]));
    expect(result.current.pastedImages.map((p) => p.file.name)).toEqual(["b.txt"]);
    expect(deps.setToast).toHaveBeenCalledWith("一次只能粘贴一个文件，已保留最新的");
    act(() => result.current.removePastedImage(0));
    expect(result.current.pastedImages).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it("uploadAndSend(file)：先 appendMsg 占位(sending) → 上传 → sendMedia → patchMsg 换 URL；进度清空、留存 File 移除", async () => {
    const { result, deps, client } = mount();
    await act(async () => { await result.current.uploadAndSend(file("doc.pdf"), "file"); });
    expect(deps.appendMsg).toHaveBeenCalledWith("u_u1_u_u2", expect.objectContaining({ contentType: "file", fileName: "doc.pdf", status: "sending", convSeq: 0 }));
    expect(client.uploadFile).toHaveBeenCalled();
    expect(client.sendMedia).toHaveBeenCalledWith("https://cdn/doc.pdf", "file", "u2", "u_u1_u_u2", expect.objectContaining({ fileName: "doc.pdf" }));
    expect(deps.patchMsg).toHaveBeenCalledWith("u_u1_u_u2", expect.any(String), expect.objectContaining({ clientMsgId: "cmid-1", content: "https://cdn/doc.pdf" }));
    expect(Object.keys(result.current.uploadProgress)).toHaveLength(0);
    expect(result.current.pendingFilesRef.current.size).toBe(0);
  });
  it("上传失败：patchMsg(status=failed) + 留存 File 供重试 + toast；retryUpload 移除旧行并按原会话重发", async () => {
    const { result, deps, client } = mount({ uploadFile: vi.fn(async () => { throw new Error("网络错误"); }) });
    await act(async () => { await result.current.uploadAndSend(file("doc.pdf"), "file"); });
    expect(deps.patchMsg).toHaveBeenCalledWith("u_u1_u_u2", expect.any(String), { status: "failed" });
    expect(result.current.pendingFilesRef.current.size).toBe(1);
    expect(deps.setToast).toHaveBeenCalledWith("发送失败：网络错误");
    const key = [...result.current.pendingFilesRef.current.keys()][0];
    (client.uploadFile as ReturnType<typeof vi.fn>).mockImplementation(async (f: File) => ({ url: `https://cdn/${f.name}`, contentType: "file", size: 1 }));
    await act(async () => { result.current.retryUpload({ clientMsgId: key, convId: "u_u1_u_u2", from: "u1", content: "", contentType: "file", convSeq: 0, timestamp: 1, status: "failed" }); });
    expect(deps.removeMsgRow).toHaveBeenCalledWith("u_u1_u_u2", key);
    await waitFor(() => expect(client.sendMedia).toHaveBeenCalled());
  });
  it("cancelSendMessage：移除气泡行 + 清进度/留存", () => {
    const { result, deps } = mount();
    act(() => result.current.cancelSendMessage({ clientMsgId: "k1", convId: "c", from: "u1", content: "", contentType: "file", convSeq: 0, timestamp: 1, status: "sending" }));
    expect(deps.removeMsgRow).toHaveBeenCalledWith("c", "k1");
  });
  it("onFilePicked（媒体入口）：非图片/视频被拦 → toast「只能发送图片或视频」，不发起上传", () => {
    const { result, deps, client } = mount();
    act(() => result.current.pickFile("media", "image/*")); // 置入口模式（input 不存在，click 被跳过）
    expect(result.current.attachPanel).toBe(false);
    act(() => result.current.onFilePicked({ target: { files: [file("doc.pdf", "application/pdf")] } } as unknown as React.ChangeEvent<HTMLInputElement>));
    expect(deps.setToast).toHaveBeenCalledWith("只能发送图片或视频");
    expect(client.uploadFile).not.toHaveBeenCalled();
  });
});
