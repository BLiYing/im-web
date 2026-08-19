// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGroupActions } from "./useGroupActions";
import type { AppServices } from "./AppServicesContext";
import type { GroupInfo } from "./sdk/protocol";

// 最小假客户端：只桩本簇会调到的群写接口。
function makeClient() {
  return {
    updateGroup: vi.fn().mockResolvedValue(undefined),
    setGroupAnnouncement: vi.fn().mockResolvedValue(undefined),
    setGroupMute: vi.fn().mockResolvedValue(undefined),
    setGroupSettings: vi.fn().mockResolvedValue(undefined),
    setGroupMyNickname: vi.fn().mockResolvedValue(undefined),
  };
}

// 装配假 services；askPrompt/askConfirm 用可编排的返回值。
function makeServices(client: ReturnType<typeof makeClient>, promptReturns: (string | null)[] = []) {
  const setToast = vi.fn();
  const refreshGroupInfo = vi.fn().mockResolvedValue(null);
  const refreshConversations = vi.fn().mockResolvedValue([]);
  let promptIdx = 0;
  const askPrompt = vi.fn(async () => promptReturns[promptIdx++] ?? null);
  const services = {
    clientRef: { current: client },
    setToast, comingSoon: vi.fn(),
    askConfirm: vi.fn(async () => true), askPrompt,
    refreshConversations, refreshFriends: vi.fn(async () => {}),
    refreshGroupInfo, refreshDownloadSettings: vi.fn(async () => {}),
  } as unknown as AppServices;
  return { services, setToast, refreshGroupInfo, refreshConversations, askPrompt };
}

const gp = (over: Partial<GroupInfo> = {}): GroupInfo => ({
  conv_id: "g1", name: "群", my_role: "owner", members: [],
  join_approval: false, perm_invite: false, perm_edit_info: false, perm_pin: false, history_visible: false,
  ...over,
} as GroupInfo);

describe("useGroupActions", () => {
  it("doGroupAction 成功：跑操作后刷群资料 + 会话列表，不吐司", async () => {
    const client = makeClient();
    const { services, setToast, refreshGroupInfo, refreshConversations } = makeServices(client);
    const { result } = renderHook(() => useGroupActions(services));
    await result.current.doGroupAction("g1", async () => {});
    expect(refreshGroupInfo).toHaveBeenCalledWith("g1");
    expect(refreshConversations).toHaveBeenCalled();
    expect(setToast).not.toHaveBeenCalled();
  });

  it("doGroupAction 失败：吞错并吐司「操作失败」，不抛出", async () => {
    const client = makeClient();
    const { services, setToast } = makeServices(client);
    const { result } = renderHook(() => useGroupActions(services));
    await result.current.doGroupAction("g1", async () => { throw new Error("boom"); });
    expect(setToast).toHaveBeenCalledWith("操作失败：boom");
  });

  it("doToggleGroupSetting：翻转目标位、整组回带当前值上报", async () => {
    const client = makeClient();
    const { services } = makeServices(client);
    const { result } = renderHook(() => useGroupActions(services));
    await result.current.doToggleGroupSetting(gp({ perm_pin: false, join_approval: true }), "perm_pin");
    expect(client.setGroupSettings).toHaveBeenCalledWith("g1", {
      join_approval: true, perm_invite: false, perm_edit_info: false, perm_pin: true, history_visible: false,
    });
  });

  it("doRenameGroup：新名 → updateGroup；空/同名/取消 → 不写", async () => {
    const client = makeClient();
    // 依次返回：有效新名 → 空串 → 同名 → null(取消)
    const { services } = makeServices(client, ["新群名", "  ", "群", null]);
    const { result } = renderHook(() => useGroupActions(services));
    await result.current.doRenameGroup(gp({ name: "群" }));
    expect(client.updateGroup).toHaveBeenCalledWith("g1", "新群名", undefined, "");
    await result.current.doRenameGroup(gp({ name: "群" })); // 空串
    await result.current.doRenameGroup(gp({ name: "群" })); // 同名
    await result.current.doRenameGroup(gp({ name: "群" })); // 取消
    expect(client.updateGroup).toHaveBeenCalledTimes(1); // 仅第一次写
  });

  it("doEditMyGroupNickname：新昵称 → setGroupMyNickname", async () => {
    const client = makeClient();
    const { services } = makeServices(client, ["阿强"]);
    const { result } = renderHook(() => useGroupActions(services));
    await result.current.doEditMyGroupNickname(gp({ my_nickname: "" }));
    expect(client.setGroupMyNickname).toHaveBeenCalledWith("g1", "阿强");
  });
});
