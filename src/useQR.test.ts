// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useQR, type QRDeps } from "./useQR";
import type { IMClient } from "./sdk/imSdk";
import type { GroupInfo } from "./sdk/protocol";

const err = (code: number) => Object.assign(new Error(`E${code}`), { code });
function mount(client: Record<string, unknown> = {}, over: Partial<QRDeps> = {}) {
  const c = { qrResolve: vi.fn(async () => ({ kind: "user", user_id: "u9" })), qrMyCard: vi.fn(async () => ({ code: "c1" })), groupQR: vi.fn(async () => ({ code: "g" })),
    qrResetMyCard: vi.fn(async () => ({ code: "c2" })), groupQRReset: vi.fn(async () => ({ code: "g2" })), joinGroupByCode: vi.fn(async () => ({ name: "测试群", conv_id: "g1" })), requestFriend: vi.fn(async () => true), ...client };
  const deps: QRDeps = { phase: "app", uid: "u1", myInfo: { nickname: "我", avatar_url: "" }, groupInfos: {}, clientRef: { current: c as unknown as IMClient }, setToast: vi.fn(),
    openChat: vi.fn(), openGroupChat: vi.fn(), refreshFriends: vi.fn(async () => {}), refreshConversations: vi.fn(async () => []), openPeerDetailRef: { current: vi.fn() }, ...over };
  return { ...renderHook(() => useQR(deps)), deps, c };
}
describe("useQR", () => {
  it("handleScanRaw：关扫一扫 → qrResolve → qrResult；200110 → expired；其它错 → toast", async () => {
    const { result, deps, c } = mount();
    act(() => result.current.setQrScan(true));
    await act(async () => { await result.current.handleScanRaw("raw1"); });
    expect(result.current.qrScan).toBe(false);
    expect(result.current.qrResult).toEqual({ data: { kind: "user", user_id: "u9" }, raw: "raw1" });
    c.qrResolve.mockRejectedValueOnce(err(200110));
    await act(async () => { await result.current.handleScanRaw("old"); });
    expect(result.current.qrResult?.data).toEqual({ kind: "expired" });
    c.qrResolve.mockRejectedValueOnce(new Error("网络"));
    await act(async () => { await result.current.handleScanRaw("x"); });
    expect(deps.setToast).toHaveBeenCalledWith("网络");
  });
  it("openGroupCard：仅管理员可邀请 + 我是成员 → 直接 toast 拒绝、不请求；群主 → 打开群码模态（canReset）", async () => {
    const gi = (role: string) => ({ g1: { conv_id: "g1", name: "群", my_role: role, perm_invite: true, members: [] } as unknown as GroupInfo });
    const { result, deps, c } = mount({}, { groupInfos: gi("member") });
    await act(async () => { await result.current.openGroupCard("g1"); });
    expect(deps.setToast).toHaveBeenCalledWith(expect.stringContaining("仅管理员可邀请")); expect(c.groupQR).not.toHaveBeenCalled();
    const m2 = mount({}, { groupInfos: gi("owner") });
    await act(async () => { await m2.result.current.openGroupCard("g1", true); });
    expect(m2.result.current.qrCardModal).toMatchObject({ title: "群邀请链接", kind: "group", convId: "g1", canReset: true });
  });
  it("openMyCard → 名片模态；resetQRCard → 换码 + toast", async () => {
    const { result, deps } = mount();
    await act(async () => { await result.current.openMyCard(); });
    expect(result.current.qrCardModal).toMatchObject({ kind: "me", name: "我", card: { code: "c1" } });
    await act(async () => { await result.current.resetQRCard(); });
    expect(result.current.qrCardModal?.card).toEqual({ code: "c2" });
    expect(deps.setToast).toHaveBeenCalledWith("二维码已重置，旧码已失效");
  });
  it("qrResultActions：看资料走 openPeerDetailRef；入群 300210 → 审批提示；成功 → 刷新 + 进群", async () => {
    const { result, deps, c } = mount();
    result.current.qrResultActions.onViewProfile("u9"); expect(deps.openPeerDetailRef.current).toHaveBeenCalledWith("u9");
    await act(async () => { await result.current.handleScanRaw("grp"); });
    await act(async () => { await result.current.qrResultActions.onJoinGroup("hi"); });
    expect(c.joinGroupByCode).toHaveBeenCalledWith("grp", "hi");
    await waitFor(() => expect(deps.openGroupChat).toHaveBeenCalledWith("g1"));
    c.joinGroupByCode.mockRejectedValueOnce(err(300210));
    await act(async () => { await result.current.qrResultActions.onJoinGroup("hi"); });
    expect(deps.setToast).toHaveBeenCalledWith("入群申请已提交，等待管理员审批");
  });
});
