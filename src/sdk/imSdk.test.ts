import { describe, it, expect } from "vitest";
import { shouldHealGap, nextSyncCursor } from "./imSdk";
import { friendlyMessage, FRIENDLY_MESSAGES } from "./errcode";

// 后端 errcode 权威码集镜像——**唯一来源 `../IMServer/internal/errcode/errcode.go`**。
// 后端加/删码时同步此集；下面的对齐测试据此断言前端 FRIENDLY_MESSAGES 没有映射到已作废/拼错的码。
const BACKEND_ERRCODES = new Set<number>([
  0,
  100001, 100002, 100003, // 通用/系统
  100101, 100102, 100103, // 认证鉴权
  200001, 200002, 200003, 200004, // 用户
  200101, 200102, 200103, 200104, 200105, 200106, // 好友
  200110, // 二维码
  300001, 300002, 300003, 300004, 300005, 300006, 300007, 300008, // 消息
  300101, 300102, // 会话
  300201, 300202, 300203, 300204, 300205, 300206, 300207, 300208, 300210, 300211, 300212, // 群聊（300209 已作废）
  500001, 500002, // 文件/媒体
  500101, 500102, 500103, // 语音转文字
]);

describe("friendlyMessage 错误码友好中文", () => {
  it("已知业务码映射为中文（被拉黑用模糊文案）", () => {
    expect(friendlyMessage(200102, "blocked by peer")).toBe("暂时无法添加对方为好友");
    expect(friendlyMessage(200002, "wrong password")).toBe("密码错误");
    expect(friendlyMessage(200101, "already friends")).toBe("你们已经是好友了");
    expect(friendlyMessage(200104, "x")).toBe("不能添加自己为好友");
    expect(friendlyMessage(100101, "invalid token")).toBe("登录已失效，请重新登录");
  });
  it("群错误码映射为中文", () => {
    expect(friendlyMessage(300203, "not a group member")).toBe("你不在该群中");
    expect(friendlyMessage(300202, "invalid group name")).toBe("群名不能为空且不超过 30 字");
    expect(friendlyMessage(300205, "group member limit exceeded")).toBe("群成员已达上限");
  });
  it("300204 不映射：透传服务端具体原因（如群主需先转让）", () => {
    expect(friendlyMessage(300204, "群主需先转让群主再退群")).toBe("群主需先转让群主再退群");
  });
  it("拒后冷却/邀请失效映射为中文（盖掉后端英文默认）", () => {
    expect(friendlyMessage(300211, "group join request recently rejected, try again later")).toBe("你的入群申请刚被拒绝，请稍后再试");
    expect(friendlyMessage(300212, "invite revoked")).toBe("该群已改为仅管理员可邀请，此邀请已失效");
  });
  it("未收录码回退服务端原文", () => {
    expect(friendlyMessage(999999, "服务端原文")).toBe("服务端原文");
  });
  it("未收录且无原文给兜底", () => {
    expect(friendlyMessage(123456, "")).toBe("请求失败(123456)");
  });
  it("对齐后端：FRIENDLY_MESSAGES 每个键都是 errcode.go 现存码（防映射到已作废/拼错的码）", () => {
    const mapped = Object.keys(FRIENDLY_MESSAGES).map(Number);
    const unknown = mapped.filter((c) => !BACKEND_ERRCODES.has(c));
    // 若这里报错：某个前端映射的码在后端 errcode.go 已不存在（作废/改义/拼错）——会显示错误中文，须修表或同步 BACKEND_ERRCODES。
    expect(unknown).toEqual([]);
  });
});

describe("shouldHealGap 离线空洞自愈判定", () => {
  it("conv_seq 跳号(>已同步+1) 且会话在跟踪 → 需自愈", () => {
    expect(shouldHealGap(2, 5, true)).toBe(true);
  });
  it("连续(已同步+1) → 不自愈", () => {
    expect(shouldHealGap(2, 3, true)).toBe(false);
  });
  it("初始位点 0 却先收到较大序号 → 从 0 自愈", () => {
    expect(shouldHealGap(0, 5, true)).toBe(true);
  });
  it("初始位点 0 收到第 1 条是连续消息", () => {
    expect(shouldHealGap(0, 1, true)).toBe(false);
  });
  it("会话未跟踪 → 不自愈", () => {
    expect(shouldHealGap(2, 5, false)).toBe(false);
  });
  it("回退/历史分页(seq<=已同步) → 不自愈", () => {
    expect(shouldHealGap(5, 3, true)).toBe(false);
    expect(shouldHealGap(5, 5, true)).toBe(false);
  });
});

describe("nextSyncCursor 按 covered_conv_seq 推进游标（破解可见性空洞死循环）", () => {
  it("covered 大于当前游标 → 跳过不可见空洞推进到 covered", () => {
    // history_visible 新成员：游标 0，本页只下发入群后消息，服务端 covered=141 覆盖入群前空洞。
    expect(nextSyncCursor(0, 141)).toBe(141);
  });
  it("covered 等于/小于当前游标 → 不动（空页 / 已追平）", () => {
    expect(nextSyncCursor(141, 141)).toBe(141);
    expect(nextSyncCursor(141, 100)).toBe(141);
  });
  it("缺字段 covered=0 → 保持原位（老服务端兼容，不倒退）", () => {
    expect(nextSyncCursor(50, 0)).toBe(50);
  });
});
