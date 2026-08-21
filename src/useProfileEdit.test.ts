// @vitest-environment jsdom
import { describe, it, expect, vi , afterEach } from "vitest";
import { renderHook, act , cleanup } from "@testing-library/react";
import { fakeClientRef } from "./testing/fakeIMClient";
import { useProfileEdit, type ProfileEditDeps } from "./useProfileEdit";
afterEach(cleanup); // 多次 renderHook：卸载前一用例（CODING_STYLE §八）
function mount(client: Record<string, unknown> = {}) {
  const c = { fetchMyProfile: vi.fn(async () => ({ nickname: "我", avatar_url: "a.png", tags: ["x", "y"] })), updateMyProfile: vi.fn(async (p: Record<string, unknown>) => ({ nickname: p.nickname, phone: p.phone, avatar_url: p.avatar_url })), uploadAvatar: vi.fn(async () => ({ url: "https://cdn/av.jpg" })), ...client };
  const deps: ProfileEditDeps = { clientRef: fakeClientRef(c), setToast: vi.fn() };
  return { ...renderHook(() => useProfileEdit(deps)), deps, c };
}
describe("useProfileEdit", () => {
  it("loadMyInfo 填 myInfo（phone 缺省兜底 \"\"）；openProfile 填草稿（tags 空格连接）", async () => {
    const { result } = mount();
    await act(async () => { await result.current.loadMyInfo(); });
    expect(result.current.myInfo).toEqual({ nickname: "我", phone: "", avatar_url: "a.png" });
    await act(async () => { await result.current.openProfile(); });
    expect(result.current.profileDraft).toEqual({ nickname: "我", avatar_url: "a.png", phone: "", tags: "x y" });
  });
  it("saveProfile：tags 按空格/逗号切分去空 → updateMyProfile；成功后刷新 myInfo 并关草稿", async () => {
    const { result, c } = mount();
    await act(async () => { await result.current.openProfile(); });
    act(() => result.current.setProfileDraft({ nickname: " 新名 ", avatar_url: "a.png", phone: "138", tags: "a, b  c" }));
    await act(async () => { await result.current.saveProfile(); });
    expect(c.updateMyProfile).toHaveBeenCalledWith({ nickname: "新名", avatar_url: "a.png", phone: "138", tags: ["a", "b", "c"] });
    expect(result.current.profileDraft).toBeNull(); expect(result.current.myInfo?.nickname).toBe("新名");
  });
  it("onPickAvatar：置 cropReq；裁切完成 → uploadAvatar → 草稿头像换成返回 URL + toast", async () => {
    const { result, deps, c } = mount();
    await act(async () => { await result.current.openProfile(); });
    const f = new File(["x"], "me.png", { type: "image/png" });
    act(() => result.current.onPickAvatar(f));
    expect(result.current.cropReq?.file).toBe(f);
    await act(async () => { await result.current.cropReq!.onDone(new Blob(["b"])); });
    expect(c.uploadAvatar).toHaveBeenCalled();
    expect(result.current.profileDraft?.avatar_url).toBe("https://cdn/av.jpg");
    expect(deps.setToast).toHaveBeenCalledWith("头像已更新");
  });
});
