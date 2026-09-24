// @vitest-environment jsdom
// useMediaSend（阶段 5 抽出）的发送流水线/攒批/重试回归。注入假 clientRef + 消息表三方法，断言编排顺序与副作用。
import { describe, it, expect, vi, beforeEach , afterEach } from "vitest";
import { renderHook, act, waitFor , cleanup } from "@testing-library/react";
import { fakeClientRef } from "./testing/fakeIMClient";
import { useMediaSend, type MediaSendDeps } from "./useMediaSend";
import { ALBUM_MAX } from "./albumBatch";
import { MEDIA_PICKER_ACCEPT } from "./fileTypes";

// 相册批量用例要桩掉像素探测/封面抓取：jsdom 不真加载 <img>/<video>，probeMediaMetadata 会一路空等到
// 8s 超时兜底才 resolve（超过 vitest 默认用例超时）。本文件关心的是**分组与顺序**，不是尺寸。
vi.mock("./media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./media")>()),
  probeMediaMetadata: vi.fn(async () => ({ width: 100, height: 80, durationMs: 0 })),
  makeTinyThumbFromImage: vi.fn(async () => "data:image/jpeg;base64,t"),
}));

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
    retryVoiceUpload: vi.fn(),
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
  it("拖入与粘贴同一条路（同样只留最新一个），只是提示文案说「拖入」", () => {
    const { result, deps } = mount();
    act(() => result.current.addPastedFiles([file("a.txt"), file("b.txt")], "drop"));
    expect(result.current.pastedImages.map((p) => p.file.name)).toEqual(["b.txt"]);
    expect(deps.setToast).toHaveBeenCalledWith("一次只能拖入一个文件，已保留最新的");
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
  it("resendMessage：voice 的 retry-upload 分支不走本 Hook 的 retryUpload（无留存 File），改派注入的 retryVoiceUpload", () => {
    const { result, deps } = mount();
    const voiceFailed = { clientMsgId: "v1", convId: "u_u1_u_u2", from: "u1", content: "blob:x", contentType: "voice", convSeq: 0, timestamp: 1, status: "failed" as const };
    act(() => result.current.resendMessage(voiceFailed));
    expect(deps.retryVoiceUpload).toHaveBeenCalledWith(voiceFailed);
    expect(deps.removeMsgRow).not.toHaveBeenCalled(); // 没经过通用 retryUpload（那条会先 removeMsgRow）
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

  // —— 相册宫格发送侧（M4+）——
  // 隐藏 <input type="file"> 的 multiple **不写在 JSX 里**，由 pickFile 按入口逐次赋值：
  // 「图片或视频」多选（相册要 ≥2 件才成宫格）、「文件」单选。写死在 JSX 里就没法按入口区分了。
  it("pickFile：媒体入口给 input 打开多选、文件入口关掉（否则永远凑不出 ≥2 件的一批）", () => {
    const { result } = mount();
    const inp = document.createElement("input");
    inp.type = "file";
    (result.current.fileInputRef as React.MutableRefObject<HTMLInputElement | null>).current = inp;
    act(() => result.current.pickFile("media", MEDIA_PICKER_ACCEPT));
    expect(inp.multiple).toBe(true);
    expect(inp.accept).toBe(MEDIA_PICKER_ACCEPT);
    act(() => result.current.pickFile("file", "*/*"));
    expect(inp.multiple).toBe(false);
  });

  const img = (name: string) => new File(["x"], name, { type: "image/png" });
  const pickMedia = async (r: { current: ReturnType<typeof useMediaSend> }, files: File[]) => {
    act(() => r.current.pickFile("media", MEDIA_PICKER_ACCEPT));
    await act(async () => { r.current.onFilePicked({ target: { files } } as unknown as React.ChangeEvent<HTMLInputElement>); });
  };
  const uploadsImages = () => ({ uploadFile: vi.fn(async (f: File) => ({ url: `https://cdn/${f.name}`, contentType: "image", size: f.size })) });

  it("多选 3 张 → 一个宫格：三条消息共享同一个 alb- group_id，且按选择顺序发出", async () => {
    const { result, client } = mount(uploadsImages());
    await pickMedia(result, [img("1.png"), img("2.png"), img("3.png")]);
    await waitFor(() => expect(client.sendMedia).toHaveBeenCalledTimes(3));
    const calls = (client.sendMedia as ReturnType<typeof vi.fn>).mock.calls;
    const gids = calls.map((c) => (c[4] as { groupId?: string }).groupId);
    expect(new Set(gids).size).toBe(1);            // 同一批共享，不是每张一个
    expect(gids[0]).toMatch(/^alb-/);              // 前缀与 iOS/Android 一致
    // 顺序：逐张上传是异步的，但发送必须仍按用户选择的次序（否则宫格里的图会乱序）。
    expect(calls.map((c) => c[0])).toEqual(["https://cdn/1.png", "https://cdn/2.png", "https://cdn/3.png"]);
  });

  it("只选 1 张 → 不带 group_id（普通媒体气泡，不是单格宫格）", async () => {
    const { result, client } = mount(uploadsImages());
    await pickMedia(result, [img("solo.png")]);
    await waitFor(() => expect(client.sendMedia).toHaveBeenCalledTimes(1));
    const opts = (client.sendMedia as ReturnType<typeof vi.fn>).mock.calls[0][4] as { groupId?: string };
    expect(opts.groupId).toBeUndefined();
  });

  it(`超过 ${ALBUM_MAX} 张：只发前 ${ALBUM_MAX} 张并 toast 告知，不静默丢弃（多发的会进对端库却不显示）`, async () => {
    const { result, deps, client } = mount(uploadsImages());
    await pickMedia(result, Array.from({ length: 12 }, (_, i) => img(`${i}.png`)));
    await waitFor(() => expect(client.sendMedia).toHaveBeenCalledTimes(ALBUM_MAX));
    expect(deps.setToast).toHaveBeenCalledWith(`一次最多发送 ${ALBUM_MAX} 个，已忽略后面的 3 个`);
    // 乐观气泡也只上屏 9 条——多出的 3 条连占位都不该出现。
    expect((deps.appendMsg as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(ALBUM_MAX);
  });

  it("非媒体文件不参与宫格：「文件」入口多个文件各发各的，都不带 group_id", async () => {
    const { result, client } = mount();
    act(() => result.current.pickFile("file", "*/*"));
    await act(async () => { result.current.onFilePicked({ target: { files: [file("a.pdf"), file("b.pdf")] } } as unknown as React.ChangeEvent<HTMLInputElement>); });
    await waitFor(() => expect(client.sendMedia).toHaveBeenCalledTimes(2));
    for (const c of (client.sendMedia as ReturnType<typeof vi.fn>).mock.calls) {
      expect((c[4] as { groupId?: string }).groupId).toBeUndefined();
    }
  });
});
