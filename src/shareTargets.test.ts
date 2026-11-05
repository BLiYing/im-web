import { describe, expect, it } from "vitest";
import { SYSTEM_UID, type ChatMessage, type Conversation, type FriendEntry } from "./sdk/protocol";
import { toggleCapped } from "./selection";
import { MAX_FORWARD_TARGETS } from "./useForward";
import {
  buildTargetIndex, forwardPreview, friendTarget, groupInviteMessage, groupTarget, pickableFriends, prunedTargets,
  resolveTargets, searchShareSections,
} from "./shareTargets";

const friend = (id: string, extra: Partial<FriendEntry> = {}): FriendEntry =>
  ({ user_id: id, nickname: `n${id}`, avatar_url: "", status: "accepted", updated_at: 0, ...extra });
const conv = (id: string, peer: string, extra: Partial<Conversation> = {}): Conversation =>
  ({ conv_id: id, peer, last_message: null, latest_conv_seq: 0, unread: 0, read_seq: 0, peer_read_seq: 0, ...extra });
const label = (c: Conversation) => (c.is_group ? c.name ?? "" : c.peer_nickname ?? c.peer);

describe("shareTargets 好友 conv_id 推导", () => {
  it("按协议 u_<a>_u_<b>，两 uid 按**字符串**升序（与数值序不同时也按字符串）", () => {
    expect(friendTarget("1002", friend("1001")).conv_id).toBe("u_1001_u_1002");
    expect(friendTarget("1001", friend("1002")).conv_id).toBe("u_1001_u_1002");
    // 字符串序："10" < "9"；数值序反过来。协议明确按字符串比较。
    expect(friendTarget("9", friend("10")).conv_id).toBe("u_10_u_9");
  });

  it("好友目标是单聊形状：peer=好友 uid、带备注/昵称/头像，is_group=false", () => {
    const t = friendTarget("1", friend("2", { remark: "老王", avatar_url: "/a.png" }));
    expect(t).toMatchObject({ is_group: false, peer: "2", peer_remark: "老王", peer_nickname: "n2", peer_avatar_url: "/a.png" });
  });

  it("群目标直接用 g_xxx conv_id，is_group=true", () => {
    expect(groupTarget({ conv_id: "g_1", name: "群", owner: "1", avatar_url: "", created_at: 0 }))
      .toMatchObject({ conv_id: "g_1", is_group: true, name: "群" });
  });
});

describe("shareTargets 可选好友", () => {
  it("只留 accepted；排除拉黑、已注销、系统通知、自己", () => {
    const list = [
      friend("a"), friend("b", { status: "pending" }), friend("c", { blocked: true }),
      friend("d", { deleted: true }), friend(SYSTEM_UID), friend("me"),
    ];
    expect(pickableFriends(list, "me").map((f) => f.user_id)).toEqual(["a"]);
  });

  it("顺序同 Web 通讯录：updated_at 降序（Web 无 A–Z 分组）", () => {
    const list = [friend("old", { updated_at: 1 }), friend("new", { updated_at: 3 }), friend("mid", { updated_at: 2 })];
    expect(pickableFriends(list, "me").map((f) => f.user_id)).toEqual(["new", "mid", "old"]);
  });

  it("prunedTargets：剔掉解析不到的 id，保持勾选顺序", () => {
    const idx = buildTargetIndex([conv("a", "a"), conv("b", "b")], [], []);
    expect(prunedTargets(["b", "ghost", "a"], idx)).toEqual(["b", "a"]);
  });
});

describe("shareTargets 跨来源选中集（按 conv_id）", () => {
  const me = "1";
  const recent = [conv("u_1_u_2", "2", { peer_nickname: "张三" }), conv("g_a", "", { is_group: true, name: "产品群" })];
  const friends = [friendTarget(me, friend("2")), friendTarget(me, friend("3", { nickname: "赵六" }))];
  const groups = [groupTarget({ conv_id: "g_a", name: "产品群", owner: "", avatar_url: "", created_at: 0 }),
    groupTarget({ conv_id: "g_b", name: "家庭群", owner: "", avatar_url: "", created_at: 0 })];

  it("同一个人在最近聊天与好友里是同一个 conv_id → 勾一处即两处都算选中", () => {
    expect(friends[0].conv_id).toBe(recent[0].conv_id);
  });

  it("索引按 conv_id 去重，已有会话优先（保留会话上更全的字段）", () => {
    const idx = buildTargetIndex(recent, friends, groups);
    expect(idx.size).toBe(4); // u_1_u_2, g_a, u_1_u_3, g_b
    expect(idx.get("u_1_u_2")?.peer_nickname).toBe("张三");
  });

  it("选中集按勾选顺序解析，没聊过的好友 / 会话已删的群也能解析成可发送目标；未知 id 丢弃", () => {
    const idx = buildTargetIndex(recent, friends, groups);
    const out = resolveTargets(["g_b", "u_1_u_3", "nope", "u_1_u_2"], idx);
    expect(out.map((c) => c.conv_id)).toEqual(["g_b", "u_1_u_3", "u_1_u_2"]);
    expect(out[1]).toMatchObject({ is_group: false, peer: "3" });
  });

  it("上限合计 9：三处混选到 9 个后再加任何来源都溢出，移除仍放行（取消勾选与已选栏 × 同一路径）", () => {
    let sel: string[] = [];
    const ids = ["u_1_u_2", "g_a", "u_1_u_3", "g_b", "x5", "x6", "x7", "x8", "x9"];
    for (const id of ids) sel = toggleCapped(sel, id, MAX_FORWARD_TARGETS).next;
    expect(sel).toHaveLength(9);
    expect(toggleCapped(sel, "g_new", MAX_FORWARD_TARGETS).overflow).toBe(true);
    const removed = toggleCapped(sel, "g_a", MAX_FORWARD_TARGETS);
    expect(removed.overflow).toBe(false);
    expect(removed.next).not.toContain("g_a");
    expect(removed.next).toHaveLength(8);
  });

  it("主页搜索：三处同搜，已在最近聊天里的人 / 群不在好友、群聊分组重复", () => {
    const r = searchShareSections("群", recent, friends, groups, label);
    expect(r.recent.map((c) => c.conv_id)).toEqual(["g_a"]);
    expect(r.groups.map((c) => c.conv_id)).toEqual(["g_b"]); // g_a 已在最近聊天
    const r2 = searchShareSections("n", recent, friends, groups, label);
    expect(r2.friends.map((c) => c.conv_id)).not.toContain("u_1_u_2"); // 张三已在最近聊天，好友分组去重
  });
});

describe("shareTargets 预览与群邀请", () => {
  const msg = (extra: Partial<ChatMessage>): ChatMessage =>
    ({ clientMsgId: "x", convId: "", from: "", content: "hi", contentType: "text", convSeq: 1, timestamp: 0, status: "sent", ...extra });

  it("复用引用条口径：名片 → [个人名片] 昵称；文件 → 文件名；文本给全文不截断", () => {
    expect(forwardPreview([msg({ contentType: "contact", content: JSON.stringify({ u: "2", n: "张三" }) })], "each")).toBe("[个人名片] 张三");
    expect(forwardPreview([msg({ contentType: "image", content: "/a.jpg" })], "each")).toBe("[图片]");
    const long = "x".repeat(100);
    expect(forwardPreview([msg({ content: long })], "each")).toBe(long);
  });

  it("多条：合并 → [聊天记录]；逐条 →「[逐条转发] N 条消息」", () => {
    expect(forwardPreview([msg({}), msg({})], "merged")).toBe("[聊天记录]");
    expect(forwardPreview([msg({}), msg({}), msg({})], "each")).toBe("[逐条转发] 3 条消息");
  });

  it("群邀请消息：文本 =「邀请你加入群聊「群名」」+ 换行 + 链接；from 留空（不被标成转发自）", () => {
    const m = groupInviteMessage("产品群", "https://x/q/g/abc");
    expect(m.content).toBe("邀请你加入群聊「产品群」\nhttps://x/q/g/abc");
    expect(m).toMatchObject({ contentType: "text", from: "", convSeq: 1 });
  });
});
