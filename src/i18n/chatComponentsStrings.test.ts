import { afterEach, describe, expect, it } from "vitest";
import { setPref, t } from "./index";

// W3（聊天侧组件迁移）新增的复数 / 占位符句子：钉住中英两种输出。
afterEach(() => setPref("zh-Hans"));

describe("聊天侧组件迁移键", () => {
  it("复数：已选条数 / 待审入群申请", () => {
    setPref("zh-Hans");
    expect(t("chat.select.selected", { count: 3 })).toBe("已选 3");
    expect(t("chat.banner.join_pending", { count: 2 })).toBe("2 人申请加入本群 · 点击审批");
    setPref("en");
    expect(t("chat.select.selected", { count: 3 })).toBe("3 selected");
    expect(t("chat.banner.join_pending", { count: 1 })).toBe("1 person requested to join · Tap to review");
    expect(t("chat.banner.join_pending", { count: 5 })).toBe("5 people requested to join · Tap to review");
  });
  it("占位符句子", () => {
    setPref("zh-Hans");
    expect(t("chat.reply.who", { name: "小明" })).toBe("回复 小明");
    expect(t("chat.voice.max_reached", { minutes: 5 })).toBe("语音已达 5 分钟上限，自动发送");
    expect(t("chat.file.size_tap_download", { size: "2 MB" })).toBe("2 MB · 点击下载");
    setPref("en");
    expect(t("chat.reply.who", { name: "Amy" })).toBe("Reply to Amy");
    expect(t("chat.voice.max_reached", { minutes: 5 })).toBe("Reached the 5-minute limit. Sent automatically.");
    expect(t("chat.search.from_token", { name: "Amy" })).toBe("From: Amy");
  });
});
