// @vitest-environment jsdom
// 会话列表编辑模式 Hook：进出 / 选择（含 Shift 连选）/ 切 Tab 清空 / 列表换新剔除 / 通讯录页签退出 / 批量已读 / 批量删除（确认、部分失败）。
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useConvEditMode, type UseConvEditModeOptions } from "./useConvEditMode";
import type { Conversation } from "./sdk/protocol";
import type { ChatFolder } from "./chatFolders";
afterEach(cleanup);

const conv = (id: string, unread = 0, marked = false) =>
  ({ conv_id: id, unread, marked_unread: marked, pinned_at: 0, muted: false, latest_conv_seq: 7 }) as unknown as Conversation;
const list = [conv("a", 2), conv("b"), conv("c", 0, true), conv("d")];

function setup(over: Partial<UseConvEditModeOptions> = {}, folder: ChatFolder | null = null, convs: Conversation[] = list) {
  const client = {
    markRead: vi.fn(), updateConvSettings: vi.fn(async () => {}), deleteConversation: vi.fn(async (_id: string) => {}),
  };
  const opts: UseConvEditModeOptions = {
    clientRef: { current: client as never }, conversations: convs, selectedFolder: folder, tab: "chats",
    refreshConversations: vi.fn(async () => convs), setToast: vi.fn(), askConfirm: vi.fn(async () => true),
    currentConvRef: { current: "" }, deselect: vi.fn(), ...over,
  };
  const hook = renderHook((p: UseConvEditModeOptions) => useConvEditMode(p), { initialProps: opts });
  return { hook, client, opts };
}
const ids = (h: { result: { current: { selection: ReadonlySet<string> } } }) => [...h.result.current.selection].sort();

describe("useConvEditMode", () => {
  it("进入 / 退出：选择集随之清空", () => {
    const { hook } = setup();
    act(() => hook.result.current.enter());
    act(() => hook.result.current.toggle("a"));
    expect(hook.result.current.editing).toBe(true);
    expect(ids(hook)).toEqual(["a"]);
    act(() => hook.result.current.exit());
    expect(hook.result.current.editing).toBe(false);
    expect(ids(hook)).toEqual([]);
  });

  it("Shift 连选：含两端（回归：锚点不能被本次点击覆盖后才读）", () => {
    const { hook } = setup();
    act(() => hook.result.current.enter());
    act(() => hook.result.current.toggle("a"));
    act(() => hook.result.current.toggle("c", true));
    expect(ids(hook)).toEqual(["a", "b", "c"]);
  });

  it("全选只管当前列表；再点取消全选", () => {
    const { hook } = setup();
    act(() => hook.result.current.enter());
    act(() => hook.result.current.selectAll());
    expect(hook.result.current.allSelected).toBe(true);
    expect(hook.result.current.count).toBe(4);
    act(() => hook.result.current.selectAll());
    expect(hook.result.current.count).toBe(0);
  });

  it("列表换新：已不存在的已选项被剔除、不退出编辑", () => {
    const { hook, opts } = setup();
    act(() => hook.result.current.enter());
    act(() => hook.result.current.selectAll());
    hook.rerender({ ...opts, conversations: list.filter((c) => c.conv_id !== "b") });
    expect(hook.result.current.editing).toBe(true);
    expect(ids(hook)).toEqual(["a", "c", "d"]);
  });

  it("切文件夹 Tab：清空选择、保持编辑", () => {
    const { hook, opts } = setup();
    act(() => hook.result.current.enter());
    act(() => hook.result.current.toggle("a"));
    const f: ChatFolder = { id: "f1", name: "工作", position: 0, conv_ids: ["a", "b"] };
    hook.rerender({ ...opts, selectedFolder: f });
    expect(hook.result.current.editing).toBe(true);
    expect(ids(hook)).toEqual([]);
    expect(hook.result.current.shown.map((c) => c.conv_id)).toEqual(["a", "b"]);
  });

  it("切到「通讯录」页签：退出编辑", () => {
    const { hook, opts } = setup();
    act(() => hook.result.current.enter());
    hook.rerender({ ...opts, tab: "contacts" });
    expect(hook.result.current.editing).toBe(false);
  });

  it("批量已读：只处理有未读的（含手动标未读），结束后只刷新一次并退出编辑", async () => {
    const { hook, client, opts } = setup();
    act(() => hook.result.current.enter());
    act(() => hook.result.current.selectAll());
    expect(hook.result.current.canRead).toBe(true);
    await act(async () => { await hook.result.current.markRead(); });
    expect(client.markRead).toHaveBeenCalledTimes(1);
    expect(client.markRead).toHaveBeenCalledWith("a", 7);
    expect(client.updateConvSettings).toHaveBeenCalledTimes(1);
    expect(client.updateConvSettings).toHaveBeenCalledWith("c", { pinned_at: 0, muted: false, marked_unread: false });
    expect(opts.refreshConversations).toHaveBeenCalledTimes(1);
    expect(hook.result.current.editing).toBe(false);
  });

  it("没有未读的选中项：已读不可用", () => {
    const { hook } = setup();
    act(() => hook.result.current.enter());
    act(() => hook.result.current.toggle("b"));
    expect(hook.result.current.canRead).toBe(false);
  });

  it("批量删除：确认后逐条删，全部成功退出编辑；文件夹 Tab 内确认文案与「全部」相同", async () => {
    const f: ChatFolder = { id: "f1", name: "工作", position: 0, conv_ids: ["a", "b"] };
    const { hook, client, opts } = setup({}, f);
    act(() => hook.result.current.enter());
    act(() => hook.result.current.selectAll());
    await act(async () => { await hook.result.current.removeSelected(); });
    expect(opts.askConfirm).toHaveBeenCalledWith(expect.not.stringContaining("所有文件夹"), expect.objectContaining({ danger: true }));
    expect(client.deleteConversation).toHaveBeenCalledTimes(2);
    expect(opts.refreshConversations).toHaveBeenCalledTimes(1);
    expect(hook.result.current.editing).toBe(false);
  });

  it("批量删除：取消确认什么都不删", async () => {
    const { hook, client } = setup({ askConfirm: vi.fn(async () => false) });
    act(() => hook.result.current.enter());
    act(() => hook.result.current.toggle("a"));
    await act(async () => { await hook.result.current.removeSelected(); });
    expect(client.deleteConversation).not.toHaveBeenCalled();
    expect(hook.result.current.editing).toBe(true);
  });

  it("批量删除部分失败：toast、失败项保留勾选、留在编辑模式", async () => {
    const { hook, client, opts } = setup();
    client.deleteConversation.mockImplementation(async (id: string) => { if (id === "b") throw new Error("boom"); });
    act(() => hook.result.current.enter());
    act(() => hook.result.current.toggle("a"));
    act(() => hook.result.current.toggle("b"));
    await act(async () => { await hook.result.current.removeSelected(); });
    expect(opts.setToast).toHaveBeenCalledWith(expect.stringContaining("1"));
    expect(ids(hook)).toEqual(["b"]);
    expect(hook.result.current.editing).toBe(true);
  });

  it("删掉的是当前打开的会话：退出该会话（deselect）而不是另刷列表", async () => {
    const { hook, opts } = setup({ currentConvRef: { current: "a" } });
    act(() => hook.result.current.enter());
    act(() => hook.result.current.toggle("a"));
    await act(async () => { await hook.result.current.removeSelected(); });
    expect(opts.deselect).toHaveBeenCalledTimes(1);
    expect(opts.refreshConversations).not.toHaveBeenCalled();
  });
});
