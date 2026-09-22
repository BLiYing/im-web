import { describe, expect, it, vi } from "vitest";
import { buildSettingsInfoRows } from "./settingsInfoRows";

const t = (k: string) => `T(${k})`;
const base = () => ({ t, uid: "u1", openProfile: vi.fn(), openMyCard: vi.fn(), shareContactCard: vi.fn() });

describe("buildSettingsInfoRows", () => {
  it("有资料：手机号原样、用户名带 @；无资料：回落「未设置」文案键", () => {
    const full = buildSettingsInfoRows({ ...base(), myInfo: { phone: "13700000001", username: "bob" } });
    expect(full.map((r) => r.label)).toEqual(["13700000001", "@bob", "T(settings.info.my_qr)", "T(settings.info.share_card)"]);
    const empty = buildSettingsInfoRows({ ...base(), myInfo: null });
    expect(empty[0].label).toBe("T(settings.info.not_set)");
    expect(empty[1].label).toBe("T(settings.info.not_set)");
  });

  it("分享名片必须带上 username（名片副标题的唯一来源，回归 2026-09 那次漏带）", () => {
    const b = base();
    const rows = buildSettingsInfoRows({ ...b, myInfo: { username: "bob", nickname: "Bob", avatar_url: "/a.png" } });
    rows[3].onClick?.();
    expect(b.shareContactCard).toHaveBeenCalledWith({ userId: "u1", username: "bob", nickname: "Bob", avatarUrl: "/a.png" });
  });

  it("手机号 / 用户名 / 二维码行分别指向各自的动作", () => {
    const b = base();
    const rows = buildSettingsInfoRows({ ...b, myInfo: {} });
    rows[0].onClick?.(); rows[1].onClick?.(); rows[2].onClick?.();
    expect(b.openProfile).toHaveBeenCalledTimes(2);
    expect(b.openMyCard).toHaveBeenCalledTimes(1);
  });
});
