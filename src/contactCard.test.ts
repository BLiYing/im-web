import { describe, it, expect } from "vitest";
import { parseContactCard, buildContactCard, contactCardPreview } from "./contactCard";

describe("parseContactCard", () => {
  it("完整快照", () => {
    expect(parseContactCard('{"u":"1002","n":"小明","a":"/avatars/ab12.jpg"}'))
      .toEqual({ userId: "1002", nickname: "小明", avatarUrl: "/avatars/ab12.jpg" });
  });
  it("只有 u 也合法", () => {
    expect(parseContactCard('{"u":"1002"}'))
      .toEqual({ userId: "1002", nickname: undefined, avatarUrl: undefined });
  });
  it("空白归一化成「无」", () => {
    expect(parseContactCard('{"u":" 1002 ","n":"  "}'))
      .toEqual({ userId: "1002", nickname: undefined, avatarUrl: undefined });
  });
  // 缺 u / 非法 JSON / 非对象一律 null —— 调用方据此把脏名片挡在列表之外。
  it.each([
    ['缺 u', '{"n":"小明"}'],
    ['u 全空白', '{"u":"   "}'],
    ['非法 JSON', "not json"],
    ['JSON 数组', '["1002"]'],
    ['JSON 标量', '"1002"'],
    ['null', "null"],
    ['空串', ""],
    ['u 非字符串', '{"u":123}'],
  ])("%s → null", (_name, content) => {
    expect(parseContactCard(content)).toBeNull();
  });
  it("undefined/null 入参不崩", () => {
    expect(parseContactCard(undefined)).toBeNull();
    expect(parseContactCard(null)).toBeNull();
  });
});

describe("buildContactCard", () => {
  it("往返一致", () => {
    const json = buildContactCard("1002", null, "小明", "/a.jpg")!;
    expect(parseContactCard(json)).toEqual({ userId: "1002", nickname: "小明", avatarUrl: "/a.jpg" });
  });
  it("空昵称/头像不写进 JSON（对齐服务端 omitempty）", () => {
    const json = buildContactCard("1002", null, "", null)!;
    expect(json).toBe('{"u":"1002"}');
  });
  it("uid 为空 → null", () => {
    expect(buildContactCard("", null, "小明")).toBeNull();
    expect(buildContactCard("   ")).toBeNull();
    expect(buildContactCard(null)).toBeNull();
  });
  // 本设计最容易写错的一行：快照里的 n 必须是真实昵称，绝不能是备注。
  it("只写入调用方给的昵称，备注不会混进来", () => {
    const json = buildContactCard("1002", null, "王建国")!;   // 真实昵称
    expect(json).not.toContain("老王");                  // 备注
    expect(parseContactCard(json)!.nickname).toBe("王建国");
  });
});

describe("contactCardPreview（与 iOS IMContactCardPreview 同口径）", () => {
  it("有昵称", () => expect(contactCardPreview('{"u":"1002","n":"小明"}')).toBe("[个人名片] 小明"));
  // 无昵称 → 退 @username；**绝不回落 userId**（10 位随机数字内部 ID）。
  // 与服务端 contactReplySnapshot、iOS IMContactCardPreview 同口径。
  it("无昵称退 @username", () => expect(contactCardPreview('{"u":"4820571639","un":"xiaoming"}')).toBe("[个人名片] @xiaoming"));
  it("昵称与句柄都无 → 不带任何 ID", () => expect(contactCardPreview('{"u":"4820571639"}')).toBe("[个人名片]"));
  it("非法 JSON 回落", () => expect(contactCardPreview('{"u":"截断')).toBe("[个人名片]"));
  it("空入参回落", () => expect(contactCardPreview(undefined)).toBe("[个人名片]"));
});

// un（username 快照）：往返、老消息缺席时的向后兼容、空值不写键。
describe("contactCard 的 un（username 快照）", () => {
  it("构造带上、解析读出", () => {
    const json = buildContactCard("4820571639", "xiaoming", "小明", "/a.jpg")!;
    expect(JSON.parse(json)).toEqual({ u: "4820571639", un: "xiaoming", n: "小明", a: "/a.jpg" });
    const c = parseContactCard(json)!;
    expect(c.username).toBe("xiaoming");
    expect(c.userId).toBe("4820571639");
  });

  // 老消息没有 un → username 为 undefined，其余照常解析，不降级整张卡。
  it("老消息无 un 时优雅退化", () => {
    const c = parseContactCard('{"u":"4820571639","n":"小明"}')!;
    expect(c).not.toBeNull();
    expect(c.username).toBeUndefined();
    expect(c.nickname).toBe("小明");
  });

  it("空 username 不写进 JSON（不留空键）", () => {
    const json = buildContactCard("4820571639", "", "小明")!;
    expect(json).not.toContain('"un"');
  });
});
