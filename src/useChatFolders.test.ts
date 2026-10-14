// @vitest-environment jsdom
// useChatFolders：整表替换 / 版本去重 / 落盘按账号隔离 / 写操作以回包为准 / 帧不带 limits 时沿用本地。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { createRef } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import { useChatFolders } from "./useChatFolders";

vi.mock("./sdk/foldersApi", () => ({
  fetchFolders: vi.fn(), createFolder: vi.fn(), renameFolder: vi.fn(),
  deleteFolder: vi.fn(), reorderFolders: vi.fn(), changeFolderConvs: vi.fn(),
}));
import * as api from "./sdk/foldersApi";

afterEach(cleanup);
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

const snap = (version: number, folders: Array<[string, string, string[]]>, limits?: object) => ({
  version,
  folders: folders.map(([id, name, ids], i) => ({ id, name, position: i, conv_ids: ids })),
  ...(limits ? { limits } : {}),
});

function mount(token = "tk") {
  const clientRef = createRef<IMClient | null>() as MutableRefObject<IMClient | null>;
  clientRef.current = { authToken: token } as unknown as IMClient;
  return renderHook(() => useChatFolders({ clientRef }));
}

describe("整表替换与版本去重", () => {
  it("版本更新才替换，同版本 / 更旧丢弃", () => {
    const { result } = mount();
    act(() => { result.current.adopt("u1"); });
    let ok = false;
    act(() => { ok = result.current.applyRaw(snap(5, [["f1", "A", []]])); });
    expect(ok).toBe(true);
    act(() => { ok = result.current.applyRaw(snap(5, [["f9", "Z", []]]), { fromFrame: true }); });
    expect(ok).toBe(false);
    act(() => { ok = result.current.applyRaw(snap(4, [])); });
    expect(ok).toBe(false);
    expect(result.current.snapshot.folders.map((f) => f.id)).toEqual(["f1"]);
    act(() => { result.current.applyRaw(snap(6, [])); }); // 清空也是合法整表
    expect(result.current.snapshot.folders).toEqual([]);
  });

  it("limits 随回包更新；帧不带 limits 时沿用本地", () => {
    const { result } = mount();
    act(() => { result.current.adopt("u1"); });
    act(() => { result.current.applyRaw(snap(1, [], { max_folders: 5, max_convs: 20, max_name: 8 })); });
    expect(result.current.snapshot.limits.max_folders).toBe(5);
    act(() => { result.current.applyRaw(snap(2, [["f1", "A", []]]), { fromFrame: true }); });
    expect(result.current.snapshot.limits).toEqual({ max_folders: 5, max_convs: 20, max_name: 8 });
  });

  it("形状不对的帧被丢弃，不当成空表", () => {
    const { result } = mount();
    act(() => { result.current.adopt("u1"); result.current.applyRaw(snap(3, [["f1", "A", []]])); });
    act(() => { result.current.applyRaw({ version: 9 }, { fromFrame: true }); });
    expect(result.current.snapshot.version).toBe(3);
  });
});

describe("落盘与账号隔离", () => {
  it("按账号落盘，换号清内存，切回读盘", () => {
    const { result } = mount();
    act(() => { result.current.adopt("a"); result.current.applyRaw(snap(7, [["f1", "A", ["c1"]]])); });
    act(() => { result.current.adopt("b"); });
    expect(result.current.snapshot.folders).toEqual([]);
    act(() => { result.current.applyRaw(snap(1, [["g1", "B-only", []]])); });
    act(() => { result.current.adopt("a"); });
    expect(result.current.snapshot.version).toBe(7);
    expect(result.current.snapshot.folders.map((f) => f.id)).toEqual(["f1"]);
  });

  it("forget 清内存与选中，落盘保留", () => {
    const { result } = mount();
    act(() => { result.current.adopt("a"); result.current.applyRaw(snap(2, [["f1", "A", []]])); result.current.setSelectedId("f1"); });
    expect(result.current.selectedFolder?.id).toBe("f1");
    act(() => { result.current.forget(); });
    expect(result.current.snapshot.folders).toEqual([]);
    expect(result.current.selectedId).toBeNull();
    expect(localStorage.getItem("im.chatFolders.v1.a")).not.toBeNull();
  });

  it("选中的文件夹被别的设备删了 → selectedFolder 回落全部", () => {
    const { result } = mount();
    act(() => { result.current.adopt("a"); result.current.applyRaw(snap(2, [["f1", "A", []]])); result.current.setSelectedId("f1"); });
    act(() => { result.current.applyRaw(snap(3, []), { fromFrame: true }); });
    expect(result.current.selectedFolder).toBeNull();
    expect(result.current.selectedId).toBeNull();
  });
});

describe("写操作以回包为准", () => {
  it("create 找回按 client_id 派生的新文件夹；changeConvs / rename / remove 用回包整表替换", async () => {
    const { result } = mount();
    act(() => { result.current.adopt("a"); });
    (api.createFolder as ReturnType<typeof vi.fn>).mockImplementation(async (_t: string, name: string, ids: string[], clientId: string) =>
      snap(1, [[`f_${clientId}`, name, ids]]));
    let created: { id: string; name: string } | null = null;
    await act(async () => { created = await result.current.create("工作", ["c1"]); });
    expect(created!.name).toBe("工作");
    const id = created!.id;
    (api.changeFolderConvs as ReturnType<typeof vi.fn>).mockResolvedValue(snap(2, [[id, "工作", ["c2"]]]));
    await act(async () => { await result.current.changeConvs(id, ["c2"], ["c1"]); });
    expect(result.current.snapshot.folders[0].conv_ids).toEqual(["c2"]);
    (api.renameFolder as ReturnType<typeof vi.fn>).mockResolvedValue(snap(3, [[id, "项目", ["c2"]]]));
    await act(async () => { await result.current.rename(id, "项目"); });
    expect(result.current.snapshot.folders[0].name).toBe("项目");
    (api.deleteFolder as ReturnType<typeof vi.fn>).mockResolvedValue(snap(4, []));
    await act(async () => { await result.current.remove(id); });
    expect(result.current.snapshot.folders).toEqual([]);
  });

  it("失败原样抛出，本地快照不变", async () => {
    const { result } = mount();
    act(() => { result.current.adopt("a"); result.current.applyRaw(snap(2, [["f1", "A", []]])); });
    (api.renameFolder as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("duplicate"));
    await expect(act(async () => { await result.current.rename("f1", "B"); })).rejects.toThrow("duplicate");
    expect(result.current.snapshot.folders[0].name).toBe("A");
  });

  it("refresh 失败保留本地缓存", async () => {
    const { result } = mount();
    act(() => { result.current.adopt("a"); result.current.applyRaw(snap(2, [["f1", "A", []]])); });
    (api.fetchFolders as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.snapshot.folders.map((f) => f.id)).toEqual(["f1"]);
  });
});
