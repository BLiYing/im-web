import { describe, it, expect } from "vitest";
import { userCardAction, groupCardAction, classifyUnknown, errorCode } from "./qr";
import type { QRUserCard, QRGroupCard } from "./sdk/protocol";

const uc = (relation: QRUserCard["relation"]): QRUserCard => ({
  user_id: "u1", nickname: "小明", avatar_url: "", relation,
});
const gc = (o: Partial<QRGroupCard>): QRGroupCard => ({
  group_id: "g1", name: "群", avatar_url: "", member_count: 3, inviter_nickname: "群主",
  joined: false, joinable: true, reason: "", ...o,
});

describe("userCardAction", () => {
  it("stranger → 加好友", () => expect(userCardAction(uc("stranger")).kind).toBe("add"));
  it("friend → 发消息", () => expect(userCardAction(uc("friend")).kind).toBe("message"));
  it("self → 看自己资料，不出现加好友", () => expect(userCardAction(uc("self")).kind).toBe("self"));
  it("blocked → 不给加好友入口", () => expect(userCardAction(uc("blocked")).kind).toBe("blocked"));
});

describe("groupCardAction", () => {
  it("已在群 → 进入群聊", () => expect(groupCardAction(gc({ joined: true })).kind).toBe("enter"));
  it("可直接加入", () => expect(groupCardAction(gc({ reason: "" })).kind).toBe("join"));
  it("需审批 → 申请加入", () => {
    const a = groupCardAction(gc({ reason: "approval" }));
    expect(a.kind).toBe("apply");
    expect(a.note).toContain("审批");
  });
  it("群满 → 不可加入", () => {
    const a = groupCardAction(gc({ joinable: false, reason: "full" }));
    expect(a.kind).toBe("disabled");
    expect(a.label).toContain("满");
  });
  it("黑名单 → 不可加入", () => expect(groupCardAction(gc({ joinable: false, reason: "banned" })).kind).toBe("disabled"));
});

describe("classifyUnknown", () => {
  it("URL 抽域名", () => {
    const r = classifyUnknown("https://shop.unknown-site.cn/pay?order=88213");
    expect(r.isUrl).toBe(true);
    expect(r.domain).toBe("shop.unknown-site.cn");
  });
  it("纯文本非 URL", () => expect(classifyUnknown("just some text").isUrl).toBe(false));
  it("首尾空白容忍", () => expect(classifyUnknown("  https://a.com/x  ").domain).toBe("a.com"));
});

describe("errorCode", () => {
  it("读 Error.code", () => {
    const e = Object.assign(new Error("x"), { code: 300210 });
    expect(errorCode(e)).toBe(300210);
  });
  it("无 code → 0", () => expect(errorCode(new Error("x"))).toBe(0));
  it("非对象 → 0", () => expect(errorCode("nope")).toBe(0));
});
