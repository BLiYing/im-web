import { describe, expect, it } from "vitest";
import { sendRejectNote } from "./errcode";

describe("sendRejectNote（发送被拒提示，三端同口径：iOS IMSendRejectionShowsNote 白名单）", () => {
  it("拉黑 / 非好友 / 内容过大用专用文案，不用服务端原文，也不是加好友措辞", () => {
    expect(sendRejectNote(200102)).toBe("消息已发出，但被对方拒收了");
    expect(sendRejectNote(200103)).toBe("消息已发出，但被对方拒收了。请先发送好友申请。");
    expect(sendRejectNote(300001)).toBe("消息内容过大，无法发送");
  });
  it("禁言 / 非群成员 / 全员禁言 / 成员级禁言：有提示", () => {
    expect(sendRejectNote(300004)).toBe("账号已被禁言");
    expect(sendRejectNote(300203)).toBe("你不在该群中");
    expect(sendRejectNote(300206)).toBe("本群已开启全员禁言");
    expect(sendRejectNote(300208)).toBe("你已被管理员禁言");
  });
  it("白名单之外（限频 300002 等）没有提示：消息仍可重发", () => {
    expect(sendRejectNote(300002)).toBe("");
    expect(sendRejectNote(999999)).toBe("");
  });
});
