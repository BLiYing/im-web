import { afterEach, describe, expect, it } from "vitest";
import { setPref, t } from "./index";

// W2（App.tsx 迁移）新增的复数 / 占位符句子：钉住中英两种输出。
afterEach(() => setPref("zh-Hans"));

describe("App.tsx 迁移键", () => {
  it("复数：成员数（含大群）", () => {
    setPref("en");
    expect(t("chat.header.member_count", { count: 1 })).toBe("1 member");
    expect(t("chat.header.member_count", { count: 3 })).toBe("3 members");
    expect(t("chat.header.member_count_super", { count: 3 })).toBe("3 members · Large group");
    expect(t("chat.select.max", { count: 9 })).toBe("You can select up to 9 messages");
    setPref("zh-Hans");
    expect(t("chat.header.member_count_super", { count: 3 })).toBe("3 位成员 · 大群");
    expect(t("chat.select.max", { count: 9 })).toBe("最多选择 9 条");
  });
  it("占位符句子", () => {
    setPref("zh-Hans");
    expect(t("chat.typing_named", { name: "小明" })).toBe("小明 正在输入");
    expect(t("common.error.action_failed", { detail: "x" })).toBe("操作失败：x");
    expect(t("login.reconnect_failed_confirm", { msg: "掉线" })).toBe("掉线。点\"确定\"重新登录；\"取消\"可继续查看本地聊天记录。");
    setPref("en");
    expect(t("chat.typing_named", { name: "Amy" })).toBe("Amy is typing…");
    expect(t("group.announcement.published_at", { time: "Sep 21 14:05" })).toBe("Posted Sep 21 14:05");
  });
});
