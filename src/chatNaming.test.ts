// chatNaming：显示名/头像解析器的口径。这些链条此前内联在 App.tsx 里、**一条都测不到**，
// 抽成纯工厂的主要收益就是这个文件。
//
// 钉两类东西：① 各条链的优先级顺序；② **末级绝不是内部 ID**
//（../IMServer/docs/design/ACCOUNT_IDENTITY_REDESIGN.md §7.5 的硬约束，曾四轮排查出 33 处）。
import { describe, it, expect } from "vitest";
import { makeNameResolvers, type NamingSources } from "./chatNaming";
import type { ChatMessage, Conversation, FriendEntry, GroupInfo, UserCard } from "./sdk/protocol";

const UID = "4820571639"; // 10 位随机内部 ID：任何断言里出现它都是 bug

const sources = (over: Partial<NamingSources> = {}): NamingSources => ({
  remarks: new Map(), friends: [], conversations: [], groupInfos: {},
  peerCards: {}, searchResults: null, profileCards: {}, ...over,
});
const conv = (o: Partial<Conversation>): Conversation => ({ conv_id: "c1", peer: UID, ...o } as Conversation);
const group = (members: unknown[], o: Partial<GroupInfo> = {}): GroupInfo =>
  ({ conv_id: "g1", members, ...o } as GroupInfo);
const msg = (o: Partial<ChatMessage>): ChatMessage => ({ convId: "g1", from: UID, ...o } as ChatMessage);

describe("好友 / 会话显示名：备注 > 昵称 > @句柄 > 占位", () => {
  it("备注优先于昵称", () => {
    const r = makeNameResolvers(sources({ remarks: new Map([[UID, "老王"]]) }));
    expect(r.friendLabel({ user_id: UID, nickname: "小明" } as FriendEntry)).toBe("老王");
  });
  it("没备注用昵称；没昵称退 @句柄", () => {
    const r = makeNameResolvers(sources());
    expect(r.friendLabel({ user_id: UID, nickname: "小明", username: "xm" } as FriendEntry)).toBe("小明");
    expect(r.friendLabel({ user_id: UID, nickname: "", username: "xm" } as FriendEntry)).toBe("@xm");
  });
  it("全缺时落占位，**不落内部 ID**", () => {
    const r = makeNameResolvers(sources());
    expect(r.friendLabel({ user_id: UID } as FriendEntry)).toBe("未命名用户");
  });
  it("群会话标题用群备注 > 群名；单聊走对端链", () => {
    const r = makeNameResolvers(sources({ remarks: new Map([[UID, "老王"]]) }));
    expect(r.convDisplayLabel(conv({ is_group: true, remark: "项目群", name: "开发群" }))).toBe("项目群");
    expect(r.convDisplayLabel(conv({ is_group: true, name: "开发群" }))).toBe("开发群");
    expect(r.convDisplayLabel(conv({ is_group: false, peer_nickname: "小明" }))).toBe("老王");
  });
});

describe("群成员昵称：群昵称 > 全局昵称 > 全局解析缓存 > 空串", () => {
  const gi = { g1: group([{ user_id: UID, nickname: "小明", group_nickname: "组长" }]) };
  it("群昵称优先", () => {
    expect(makeNameResolvers(sources({ groupInfos: gi })).memberNick("g1", UID)).toBe("组长");
  });
  it("成员表查不到 → 退全局解析缓存（**超级群里这是常态**：成员表只含群主+管理员）", () => {
    const r = makeNameResolvers(sources({ groupInfos: { g1: group([]) }, profileCards: { [UID]: { nickname: "小明" } as UserCard } }));
    expect(r.memberNick("g1", UID)).toBe("小明");
  });
  it("都查不到回空串（由调用方走自己的兜底），不回内部 ID", () => {
    expect(makeNameResolvers(sources()).memberNick("g1", UID)).toBe("");
  });
  it("localNameOf：备注压过群昵称；都没有时用 fallback", () => {
    const withRemark = makeNameResolvers(sources({ groupInfos: gi, remarks: new Map([[UID, "老王"]]) }));
    expect(withRemark.localNameOf(UID, "g1")).toBe("老王");
    expect(makeNameResolvers(sources()).localNameOf(UID, "g1", "服务端字面")).toBe("服务端字面");
  });
});

describe("气泡发送者：名字 / 角色 / 头像", () => {
  it("senderLabel 优先消息自带 from_nickname（历史消息不随成员表变）", () => {
    const r = makeNameResolvers(sources({ groupInfos: { g1: group([{ user_id: UID, nickname: "现昵称" }]) } }));
    expect(r.senderLabel(msg({ fromNickname: "发时昵称" }))).toBe("发时昵称");
  });
  it("senderRole 优先成员表当前角色，查不到才退消息自带 from_role", () => {
    const inTable = makeNameResolvers(sources({ groupInfos: { g1: group([{ user_id: UID, role: "admin" }]) } }));
    expect(inTable.senderRole(msg({ fromRole: "owner" }))).toBe("admin"); // 晋升/降级后老消息随之变化
    expect(makeNameResolvers(sources()).senderRole(msg({ fromRole: "owner" }))).toBe("owner");
    expect(makeNameResolvers(sources()).senderRole(msg({}))).toBeUndefined();
  });
  it("senderAvatar 成员表 → 解析缓存 → undefined", () => {
    const r = makeNameResolvers(sources({ groupInfos: { g1: group([]) }, profileCards: { [UID]: { avatar_url: "/a.png" } as UserCard } }));
    expect(r.senderAvatar(msg({}))).toBe("/a.png");
    expect(makeNameResolvers(sources()).senderAvatar(msg({}))).toBeUndefined();
  });
});

describe("peerUsername：拿不到就 undefined（整行隐藏），绝不回退内部 ID", () => {
  it("只有权威名片带句柄", () => {
    const r = makeNameResolvers(sources({ peerCards: { [UID]: { username: "xm" } as UserCard } }));
    expect(r.peerUsername(UID)).toBe("xm");
    expect(makeNameResolvers(sources()).peerUsername(UID)).toBeUndefined();
  });
});

describe("groupRemark：读会话行的 remark（服务端多端同步的那份）", () => {
  it("有则去空白返回，无则空串", () => {
    const r = makeNameResolvers(sources({ conversations: [conv({ conv_id: "g1", remark: "  项目群  " })] }));
    expect(r.groupRemark("g1")).toBe("项目群");
    expect(r.groupRemark("g2")).toBe("");
  });
});
