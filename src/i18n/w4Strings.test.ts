import { afterEach, describe, expect, it } from "vitest";
import { setPref, t } from "./index";

// W4（详情页/联系人/管理侧组件迁移）新增的复数 / 占位符句子：钉住中英两种输出。
afterEach(() => setPref("zh-Hans"));

describe("W4 详情页/联系人/管理侧迁移键", () => {
  it("复数：群成员数（普通群 / 大群）", () => {
    setPref("zh-Hans");
    expect(t("chat.header.member_count", { count: 1 })).toBe("1 位成员");
    expect(t("chat.header.member_count", { count: 5 })).toBe("5 位成员");
    expect(t("chat.header.member_count_super", { count: 20000 })).toBe("20000 位成员 · 大群");
    setPref("en");
    expect(t("chat.header.member_count", { count: 1 })).toBe("1 member");
    expect(t("chat.header.member_count", { count: 5 })).toBe("5 members");
    expect(t("chat.header.member_count_super", { count: 20000 })).toBe("20000 members · Large group");
  });

  it("占位符：管理员计数标题 / 好友分区标题（单参数与双参数）", () => {
    setPref("zh-Hans");
    expect(t("group.admin_list.count_title", { count: 2 })).toBe("管理员 · 2");
    expect(t("contacts.friends.header_count", { count: 12 })).toBe("好友（12）");
    expect(t("contacts.friends.header_filtered", { filtered: 3, total: 12 })).toBe("好友（3/12）");
    setPref("en");
    expect(t("group.admin_list.count_title", { count: 2 })).toBe("Admins · 2");
    expect(t("contacts.friends.header_count", { count: 12 })).toBe("Friends (12)");
    expect(t("contacts.friends.header_filtered", { filtered: 3, total: 12 })).toBe("Friends (3/12)");
  });

  it("占位符：移出群聊确认句 / 名片来源 / 文件大小-未下载", () => {
    setPref("zh-Hans");
    expect(t("group.member_action.remove_confirm_message", { name: "小明" }))
      .toBe("确定把 小明 移出群聊？24 小时内不可再被邀请。");
    expect(t("contact_card.row.shared_by", { source: "张三" })).toBe("由 张三 分享");
    expect(t("detail.tab.file_size_not_downloaded", { size: "2 MB" })).toBe("2 MB · 未下载");
    setPref("en");
    expect(t("group.member_action.remove_confirm_message", { name: "Amy" }))
      .toBe("Remove Amy from the group? They can't be re-invited for 24 hours.");
    expect(t("contact_card.row.shared_by", { source: "Amy" })).toBe("Shared by Amy");
    expect(t("detail.tab.file_size_not_downloaded", { size: "2 MB" })).toBe("2 MB · Not downloaded");
  });
});
