import { describe, it, expect } from "vitest";
import type { GroupInfo, GroupMember } from "./sdk/protocol";
import {
  MAX_ADMIN_BATCH, ownerOf, adminsOf, adminCountText, adminCandidates, transferCandidates,
  clampBatch, adminSlotsLeft, MAX_ADMINS, batchToast, memberSubtitle, adminErrorToast,
} from "./groupAdmin";

// 与 iOS IMGroupAdminLogicTests 逐条对齐——两端口径漂移就是"同一个群在两端管理员数不一样"的来源。
// 设计见 IMServer/docs/design/GROUP_ADMIN_TRANSFER_DESIGN.md §9 测试点 4~6、19~21。

const m = (over: Partial<GroupMember>): GroupMember =>
  ({ user_id: "0000000000", nickname: "", avatar_url: "", role: "member", joined_at: 0, ...over } as GroupMember);

// 群主 1000000001（我）+ 两位管理员 + 两位普通成员。uid 用 10 位数字，与线上内部 ID 同形态。
const gp = (over: Partial<GroupInfo> = {}): GroupInfo => ({
  conv_id: "g1", name: "产品三组", owner: "1000000001", avatar_url: "", my_role: "owner",
  members: [
    m({ user_id: "1000000001", nickname: "老王", username: "laowang", role: "owner", joined_at: 1 }),
    m({ user_id: "4820571639", nickname: "小明", username: "xiaoming", role: "admin", joined_at: 30 }),
    m({ user_id: "4820571640", nickname: "小红", username: "xiaohong", role: "admin", joined_at: 20 }),
    m({ user_id: "4820571641", nickname: "小丽", username: "xiaoli", role: "member", joined_at: 40 }),
    m({ user_id: "4820571642", nickname: "阿刚", username: "agang", role: "member", joined_at: 50 }),
  ],
  ...over,
} as GroupInfo);

describe("群主 / 管理员派生", () => {
  it("ownerOf 取群主，空群返回 undefined", () => {
    expect(ownerOf(gp())?.user_id).toBe("1000000001");
    expect(ownerOf(gp({ members: [] }))).toBeUndefined();
    expect(ownerOf(undefined)).toBeUndefined();
  });

  it("adminsOf 按 joined_at 升序（与成员列表同口径）", () => {
    expect(adminsOf(gp()).map((x) => x.user_id)).toEqual(["4820571640", "4820571639"]);
  });

  it("计数口径：0 → 未设置，>0 → N 人；群主不算管理员", () => {
    expect(adminCountText(gp())).toBe("2 人");
    expect(adminCountText(gp({ members: [] }))).toBe("未设置");
    expect(adminCountText(gp({ members: [m({ user_id: "1000000001", role: "owner" })] }))).toBe("未设置");
  });
});

describe("候选过滤", () => {
  it("添加管理员的候选排除群主、现有管理员与我自己", () => {
    expect(adminCandidates(gp(), "1000000001").map((x) => x.user_id))
      .toEqual(["4820571641", "4820571642"]);
  });

  it("即便我自己是普通成员也不列出自己", () => {
    expect(adminCandidates(gp(), "4820571641").map((x) => x.user_id)).toEqual(["4820571642"]);
  });

  it("转让候选＝全体成员 − 我（管理员也可以被选，后端不限）", () => {
    const c = transferCandidates(gp(), "1000000001");
    expect(c).toHaveLength(4);
    expect(c.some((x) => x.user_id === "1000000001")).toBe(false);
  });

  it("群里只有我一人 → 转让候选为空（弹窗走空态，不是白屏）", () => {
    const alone = gp({ members: [m({ user_id: "1000000001", role: "owner" })] });
    expect(transferCandidates(alone, "1000000001")).toHaveLength(0);
  });
});

describe("成员行副标题（身份体系 §1.3）", () => {
  it("恒为 @句柄，没有句柄就留空——绝不显示 10 位内部 ID", () => {
    expect(memberSubtitle(m({ username: "xiaoming" }))).toBe("@xiaoming");
    expect(memberSubtitle(m({ user_id: "4820571644" }))).toBe("");
  });

  it("有群昵称也不显群昵称——主名已经是群昵称了，副行再显一遍就是逐字重复", () => {
    // 主名走 groupMemberLabel（备注 > 群昵称 > 昵称），设了群昵称的成员主名就是「运维」；
    // 稿子 §5.2 的「群昵称 / 否则 @username」会让这一行变成「运维 / 运维」。iOS 侧亦为恒显句柄。
    expect(memberSubtitle(m({ group_nickname: "运维", username: "dalei" }))).toBe("@dalei");
  });
});

describe("批量上限与结果文案", () => {
  it("一次最多 5 人，多选的被截断", () => {
    expect(MAX_ADMIN_BATCH).toBe(5);
    expect(clampBatch(["a", "b", "c", "d", "e", "f"])).toEqual(["a", "b", "c", "d", "e"]);
    expect(clampBatch([])).toEqual([]);
  });

  it("全成功 / 部分失败 / 全失败三档文案", () => {
    expect(batchToast(3, 0)).toBe("已添加 3 位管理员");
    expect(batchToast(2, 1, "TA 已不在群里")).toBe("2 位已添加，1 位失败：TA 已不在群里");
    expect(batchToast(0, 2, "只有群主可以进行此操作")).toBe("只有群主可以进行此操作");
  });
});

describe("错误码映射（§4.4）", () => {
  const err = (code: number, message: string) => Object.assign(new Error(message), { code });

  it("按码给中文，不 parse 服务端英文串", () => {
    expect(adminErrorToast(err(300201, "group not found"))).toBe("该群已被解散");
    expect(adminErrorToast(err(300203, "not a group member"))).toBe("你已不在该群");
    expect(adminErrorToast(err(300204, "no group permission"))).toBe("只有群主可以进行此操作");
    // 100001 一个码复用三种语义，统一给一句可操作的中文。
    expect(adminErrorToast(err(100001, "target not in group"))).toBe("操作失败，请刷新后重试");
    expect(adminErrorToast(err(100001, "already the owner"))).toBe("操作失败，请刷新后重试");
  });

  it("未收录的码 / 无码错误回退服务端原文", () => {
    expect(adminErrorToast(new Error("Failed to fetch"))).toBe("操作失败：Failed to fetch");
  });
});

describe("管理员总数上限（现有 + 新增 ≤ 5）", () => {
  it("总上限 5；gp() 已有 2 位管理员 → 还能加 3 位", () => {
    expect(MAX_ADMINS).toBe(5);
    expect(adminSlotsLeft(gp())).toBe(3);
  });
  it("无管理员 → 5；已满 5 或超过（他端绕过）→ 0；undefined → 5", () => {
    const admins = (n: number) => Array.from({ length: n }, (_, i) => m({ user_id: `48205716${i}0`, role: "admin" }));
    expect(adminSlotsLeft(gp({ members: [] }))).toBe(5);
    expect(adminSlotsLeft(gp({ members: admins(5) }))).toBe(0);
    expect(adminSlotsLeft(gp({ members: admins(7) }))).toBe(0);
    expect(adminSlotsLeft(undefined)).toBe(5);
  });
});
