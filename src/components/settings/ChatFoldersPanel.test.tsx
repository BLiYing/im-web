// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
afterEach(cleanup);
import { AppServicesProvider, type AppServices } from "../../AppServicesContext";
import { ChatFoldersProvider } from "../../ChatFoldersContext";
import { DEFAULT_FOLDER_LIMITS } from "../../chatFolders";
import type { UseChatFolders } from "../../useChatFolders";
import type { Conversation } from "../../sdk/protocol";
import { ChatFoldersPanel } from "./ChatFoldersPanel";

const convs = [
  { conv_id: "c1", peer: "u1", name: "小明" },
  { conv_id: "c2", peer: "u2", name: "小红" },
] as unknown as Conversation[];

function mount(over: Partial<UseChatFolders["snapshot"]> = {}) {
  const folders = {
    snapshot: { version: 1, limits: DEFAULT_FOLDER_LIMITS, folders: [{ id: "f_a", name: "工作", position: 0, conv_ids: ["c1"] }], ...over },
    selectedId: null, selectedFolder: null, setSelectedId: vi.fn(), adopt: vi.fn(), refresh: vi.fn(async () => {}),
    applyRaw: vi.fn(), forget: vi.fn(), create: vi.fn(async () => null), rename: vi.fn(async () => {}),
    remove: vi.fn(async () => {}), reorder: vi.fn(async () => {}), changeConvs: vi.fn(async () => {}),
  } as unknown as UseChatFolders;
  const services = { setToast: vi.fn(), askConfirm: vi.fn(async () => true) } as unknown as AppServices;
  const r = render(
    <AppServicesProvider value={services}><ChatFoldersProvider value={folders}>
      <ChatFoldersPanel conversations={convs} convDisplayLabel={(c) => c.name ?? c.peer ?? ""} convAvatarUrl={() => undefined}
        initialEditId="f_a" onBack={vi.fn()} />
    </ChatFoldersProvider></AppServicesProvider>,
  );
  return { folders, ...r };
}

describe("ChatFoldersPanel 选择聊天", () => {
  it("编辑已有文件夹：选择聊天里勾上再点「完成」→ changeConvs(该夹 id, add, remove)，且仍停在该夹的编辑页", async () => {
    const { folders, container, getByText, queryByText } = mount();
    fireEvent.click(getByText("添加聊天"));
    const rows = container.querySelectorAll(".convitem");
    fireEvent.click(rows[1]); // 勾上 c2
    fireEvent.click(getByText("完成"));
    await waitFor(() => expect(folders.changeConvs).toHaveBeenCalledWith("f_a", ["c2"], []));
    // 回到的是「编辑」而不是「创建」：名称仍是该夹名称，且有删除入口
    expect((container.querySelector(".folder-edit-name input") as HTMLInputElement).value).toBe("工作");
    expect(queryByText("删除文件夹")).toBeTruthy();
  });
});
