import { afterEach, describe, expect, it } from "vitest";
import { setPref, t } from "./index";

// W5（顶层工具函数/hooks 迁移：messageContent 工具集/useGroupOps/menus/useChatSearch/mention/
// useMediaDownload/useGroupActions/groupAdmin）新增的复数 / 占位符句子：钉住中英两种输出。
afterEach(() => setPref("zh-Hans"));

describe("W5 顶层工具函数/hooks 迁移键", () => {
  it("复数：通用「N 人」计数 / 批量设管理员成功计数", () => {
    setPref("zh-Hans");
    expect(t("common.people_count", { count: 1 })).toBe("1 人");
    expect(t("common.people_count", { count: 5 })).toBe("5 人");
    expect(t("group.admin_list.batch_added", { count: 1 })).toBe("已添加 1 位管理员");
    expect(t("group.admin_list.batch_added", { count: 3 })).toBe("已添加 3 位管理员");
    setPref("en");
    expect(t("common.people_count", { count: 1 })).toBe("1 person");
    expect(t("common.people_count", { count: 5 })).toBe("5 people");
    expect(t("group.admin_list.batch_added", { count: 1 })).toBe("Added 1 admin");
    expect(t("group.admin_list.batch_added", { count: 3 })).toBe("Added 3 admins");
  });

  it("占位符：邀请部分成功 / 批量设管理员部分失败 / 撤销管理员确认句", () => {
    setPref("zh-Hans");
    expect(t("group.info.invite_partial", { invited: 2, skipped: 1 })).toBe("已邀请 2 人，其余 1 人已在群里");
    expect(t("group.admin_list.batch_partial", { succeeded: 2, failed: 1, error: "操作失败" }))
      .toBe("2 位已添加，1 位失败：操作失败");
    expect(t("group.ops.revoke_admin_confirm", { name: "小明" })).toBe("撤销 小明 的管理员身份？");
    setPref("en");
    expect(t("group.info.invite_partial", { invited: 2, skipped: 1 })).toBe("Invited 2; the other 1 were already in the group");
    expect(t("group.admin_list.batch_partial", { succeeded: 2, failed: 1, error: "Action failed" }))
      .toBe("2 added, 1 failed: Action failed");
    expect(t("group.ops.revoke_admin_confirm", { name: "Amy" })).toBe("Revoke Amy's admin role?");
  });

  it("占位符：日历跳转「最近一天」/「年月」标题", () => {
    setPref("zh-Hans");
    expect(t("chat.search.day_jump_nearest", { label: "9月1日", date: "9月3日" }))
      .toBe("9月1日无消息，已跳到最近的 9月3日");
    expect(t("chat.search.calendar_month_label", { year: "2026", month: "9" })).toBe("2026年9月");
    setPref("en");
    expect(t("chat.search.day_jump_nearest", { label: "Sep 1", date: "Sep 3" }))
      .toBe("No messages on Sep 1. Jumped to the nearest day, Sep 3.");
    expect(t("chat.search.calendar_month_label", { year: "2026", month: "Sep" })).toBe("Sep 2026");
  });
});
