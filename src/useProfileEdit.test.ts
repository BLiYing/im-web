// @vitest-environment jsdom
import { describe, it, expect, vi , afterEach } from "vitest";
import { renderHook, act , cleanup } from "@testing-library/react";
import { fakeClientRef } from "./testing/fakeIMClient";
import { useProfileEdit, type ProfileEditDeps } from "./useProfileEdit";
afterEach(cleanup); // 多次 renderHook：卸载前一用例（CODING_STYLE §八）
function mount(client: Record<string, unknown> = {}) {
  const c = { fetchMyProfile: vi.fn(async () => ({ nickname: "我", username: "myhandle", avatar_url: "a.png", tags: ["x", "y"] })), updateMyProfile: vi.fn(async (p: Record<string, unknown>) => ({ nickname: p.nickname, username: "myhandle", phone: p.phone, avatar_url: p.avatar_url })), updateMyUsername: vi.fn(async (u: string) => ({ nickname: "新名", username: u, phone: "138", avatar_url: "a.png" })), uploadAvatar: vi.fn(async () => ({ url: "https://cdn/av.jpg" })), ...client };
  const deps: ProfileEditDeps = { clientRef: fakeClientRef(c), setToast: vi.fn() };
  return { ...renderHook(() => useProfileEdit(deps)), deps, c };
}
describe("useProfileEdit", () => {
  it("loadMyInfo 填 myInfo（phone 缺省兜底 \"\"）；openProfile 填草稿（tags 空格连接）", async () => {
    const { result } = mount();
    await act(async () => { await result.current.loadMyInfo(); });
    expect(result.current.myInfo).toEqual({ nickname: "我", username: "myhandle", phone: "", avatar_url: "a.png" });
    await act(async () => { await result.current.openProfile(); });
    expect(result.current.profileDraft).toEqual({ nickname: "我", username: "myhandle", avatar_url: "a.png", phone: "", tags: "x y" });
  });
  it("saveProfile：tags 按空格/逗号切分去空 → updateMyProfile；成功后刷新 myInfo 并关草稿", async () => {
    const { result, c } = mount();
    await act(async () => { await result.current.openProfile(); });
    act(() => result.current.setProfileDraft({ nickname: " 新名 ", username: "myhandle", avatar_url: "a.png", phone: "138", tags: "a, b  c" }));
    await act(async () => { await result.current.saveProfile(); });
    expect(c.updateMyProfile).toHaveBeenCalledWith({ nickname: "新名", avatar_url: "a.png", phone: "138", tags: ["a", "b", "c"] });
    // username 与载入值相同 → **不**发改名请求（否则每次保存都可能撞「用户名已被占用」）。
    expect(c.updateMyUsername).not.toHaveBeenCalled();
    // 保存后**回只读态而不是关面板**（2026-08-30 双态改造）：草稿仍在（供只读态渲染），
    // editing 落回 false。用户刚改完就被关掉，看不到改后的样子。
    expect(result.current.profileEditing).toBe(false);
    expect(result.current.profileDraft?.nickname).toBe("新名");
    expect(result.current.myInfo?.nickname).toBe("新名");
  });

  it("saveProfile：username 改了才发改名请求，并用它回的名片刷新 myInfo", async () => {
    const { result, c } = mount();
    await act(async () => { await result.current.openProfile(); });
    act(() => result.current.setProfileDraft({ nickname: "新名", username: "newhandle", avatar_url: "a.png", phone: "138", tags: "" }));
    await act(async () => { await result.current.saveProfile(); });
    expect(c.updateMyUsername).toHaveBeenCalledWith("newhandle");
    expect(result.current.myInfo?.username).toBe("newhandle");
    expect(result.current.profileEditing).toBe(false);
    expect(result.current.profileDraft?.username).toBe("newhandle");
  });

  it("saveProfile：昵称清空直接拒（回退链止于昵称，空了会露出内部 ID）", async () => {
    const { result, c, deps } = mount();
    await act(async () => { await result.current.openProfile(); });
    act(() => result.current.setProfileDraft({ nickname: "   ", username: "myhandle", avatar_url: "a.png", phone: "", tags: "" }));
    await act(async () => { await result.current.saveProfile(); });
    expect(c.updateMyProfile).not.toHaveBeenCalled();
    expect(deps.setToast).toHaveBeenCalledWith("昵称不能为空");
    expect(result.current.profileDraft).not.toBeNull(); // 留在弹窗里让用户补
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

// 双态（2026-08-30，与 iOS IMProfileEditViewController 拉齐）：
// 从设置页进来默认只读，点「编辑」才可改——多数人只是想看一眼，直接给一屏输入框既突兀又易误改。
describe("useProfileEdit 的只读/编辑双态", () => {
  it("openProfile 后默认只读态", async () => {
    const { result } = mount();
    await act(async () => { await result.current.openProfile(); });
    expect(result.current.profileEditing).toBe(false);
  });

  it("enterProfileEditing → 编辑态；cancelProfileEditing → 回只读并重拉权威值", async () => {
    const { result, c } = mount();
    await act(async () => { await result.current.openProfile(); });
    act(() => result.current.enterProfileEditing());
    expect(result.current.profileEditing).toBe(true);

    // 改了草稿再取消：应回只读态，且重新拉一次 /users/me（不能把未保存的输入当成权威值留着）
    act(() => result.current.setProfileDraft({ nickname: "临时改的", username: "tmp", avatar_url: "", phone: "", tags: "" }));
    const before = c.fetchMyProfile.mock.calls.length;
    await act(async () => { result.current.cancelProfileEditing(); });
    expect(result.current.profileEditing).toBe(false);
    expect(c.fetchMyProfile.mock.calls.length).toBeGreaterThan(before);
  });
});
