import { afterEach, describe, expect, it } from "vitest";
import { setPref, t } from "./i18n";
import { buildGroupSysSegments, buildSysNoticeText, localizeReplySnapshot } from "./sysEventRender";
import { localizeSnippet } from "./messageContent";
import { sysSegmentName } from "./sysSegments";
import type { ChatMessage } from "./sdk/protocol";

/** localizeReplySnapshot 只需要这三个字段，测试用小夹具不必凑一整条 ChatMessage。 */
type Snap = Pick<ChatMessage, "replySnapshotKind" | "replySnapshotArgs" | "replySnapshot">;

const localNameOf = (uid: string, _convId: string, fallback?: string) =>
  ({ "1001": "群主张三", "1002": "李四", "1003": "王五", "1004": "赵六" }[uid] ?? fallback ?? uid);

afterEach(() => setPref("zh-Hans"));

// §1.2 通用算法：4 个不同形状的事件（两人名槽位 / 纯 args 无人名 / 无参数纯静态串 / 多人名拼接），
// 中英文两版输出都断言。
describe("buildGroupSysSegments · auto_delete（会话级自动删除）", () => {
  const mk = (sec?: string, segs: ChatMessage["sysSegments"] = [{ uid: "1001", text: "群主张三" }, { text: " 开启了自动删除，消息将在1 天后自动删除" }]): ChatMessage => ({
    convId: "c1", from: "", content: "兜底整句", contentType: "system", convSeq: 1, timestamp: 0, status: "received",
    sysEvent: "auto_delete", sysArgs: sec === undefined ? undefined : { sec }, sysSegments: segs,
  });
  it("sec>0：sys.auto_delete.on，{actor} 取首个带 uid 段（可点），{period} 折算（中英）", () => {
    const zh = buildGroupSysSegments(mk("604800"), t, "zh-Hans");
    expect(zh?.map((s) => s.text).join("")).toBe("群主张三 开启了自动删除，消息将在1 周后自动删除");
    expect(zh?.filter((s) => s.uid).map((s) => s.uid)).toEqual(["1001"]);
    setPref("en");
    expect(buildGroupSysSegments(mk("172800"), t, "en")?.map((s) => s.text).join("")).toContain("2 days");
  });
  it("sec=0：sys.auto_delete.off", () => {
    expect(buildGroupSysSegments(mk("0"), t, "zh-Hans")?.map((s) => s.text).join("")).toBe("群主张三 关闭了自动删除");
  });
  it("缺 sec / sec 非法 / 无操作者段 → undefined（调用方回退 content）", () => {
    expect(buildGroupSysSegments(mk(undefined), t, "zh-Hans")).toBeUndefined();
    expect(buildGroupSysSegments(mk("abc"), t, "zh-Hans")).toBeUndefined();
    expect(buildGroupSysSegments(mk("86400", [{ text: "x" }]), t, "zh-Hans")).toBeUndefined();
  });
});

describe("buildGroupSysSegments", () => {
  it("member_remove：两个人名槽位（actor/target），中英文语序不同都要对", () => {
    const m: ChatMessage = {
      convId: "c1", from: "", content: "", contentType: "system", convSeq: 1, timestamp: 0, status: "received",
      sysEvent: "member_remove",
      sysSegments: [{ uid: "1001", text: "群主张三" }, { uid: "1002", text: "李四" }],
    };
    const zh = buildGroupSysSegments(m, t, "zh-Hans");
    expect(zh?.map((s) => s.text).join("")).toBe("群主张三 将 李四 移出群聊");
    expect(zh?.filter((s) => s.uid).map((s) => s.uid)).toEqual(["1001", "1002"]);
    setPref("en");
    const en = buildGroupSysSegments(m, t, "en");
    expect(en?.map((s) => s.text).join("")).toBe("群主张三 removed 李四 from the group");
  });

  it("group_rename：纯 args 无人名槽位", () => {
    const m: ChatMessage = {
      convId: "c1", from: "", content: "", contentType: "system", convSeq: 1, timestamp: 0, status: "received",
      sysEvent: "group_rename", sysArgs: { name: "摸鱼群" },
    };
    expect(buildGroupSysSegments(m, t, "zh-Hans")?.map((s) => s.text).join(""))
      .toBe("群名已改为「摸鱼群」");
    setPref("en");
    expect(buildGroupSysSegments(m, t, "en")?.map((s) => s.text).join(""))
      .toBe('Group name changed to "摸鱼群"');
  });

  it("mute_all_on：无参数纯静态串", () => {
    const m: ChatMessage = { convId: "c1", from: "", content: "", contentType: "system", convSeq: 1, timestamp: 0, status: "received", sysEvent: "mute_all_on" };
    expect(buildGroupSysSegments(m, t, "zh-Hans")).toEqual([{ text: "管理员开启了全员禁言" }]);
    setPref("en");
    expect(buildGroupSysSegments(m, t, "en")).toEqual([{ text: "An admin turned on mute-all" }]);
  });

  it("friend_accepted：单聊系统消息（sender 空、无 args/segments），按 App 语言渲染，不崩", () => {
    const m: ChatMessage = {
      convId: "u_1001_u_1002", from: "", content: "你们已成为好友，现在可以开始聊天了", contentType: "system",
      convSeq: 1, timestamp: 0, status: "received", sysEvent: "friend_accepted",
    };
    expect(buildGroupSysSegments(m, t, "zh-Hans")).toEqual([{ text: "你们已成为好友，现在可以开始聊天了" }]);
    setPref("en");
    expect(buildGroupSysSegments(m, t, "en")).toEqual([{ text: "You are now friends. You can start chatting." }]);
  });

  it("member_invite：actor 来自第 1 个候选段，其余候选逐个出名字段（全部可点），之间按语言插分隔符", () => {
    const m: ChatMessage = {
      convId: "c1", from: "", content: "", contentType: "system", convSeq: 1, timestamp: 0, status: "received",
      sysEvent: "member_invite",
      sysSegments: [{ uid: "1001", text: "群主张三" }, { uid: "1002", text: "李四" }, { uid: "1003", text: "王五" }],
    };
    const zh = buildGroupSysSegments(m, t, "zh-Hans");
    expect(zh?.map((s) => s.text).join("")).toBe("群主张三 邀请 李四、王五 加入群聊");
    // actor 与每个被邀请者都带 uid（可点），分隔符是不带 uid 的文案段。
    expect(zh?.filter((s) => s.uid)).toEqual([
      { uid: "1001", text: "群主张三" }, { uid: "1002", text: "李四" }, { uid: "1003", text: "王五" },
    ]);
    setPref("en");
    const en = buildGroupSysSegments(m, t, "en");
    expect(en?.map((s) => s.text).join("")).toBe("群主张三 invited 李四, 王五 to the group");
  });

  it("member_invite：被邀请者里有自己 → 显示「我」（与聊天页系统行同口径）", () => {
    const m: ChatMessage = {
      convId: "c1", from: "", content: "", contentType: "system", convSeq: 1, timestamp: 0, status: "received",
      sysEvent: "member_invite",
      sysSegments: [{ uid: "1001", text: "群主张三" }, { uid: "9999", text: "本人" }],
    };
    const zh = buildGroupSysSegments(m, t, "zh-Hans");
    // 名字段保留服务端字面，「我」由渲染层（renderSysLine/convPreview）用 sysSegmentName 按 uid 替换——这里走同一套。
    const shown = zh?.map((s) => (s.uid ? sysSegmentName(s.uid, "9999", (id) => localNameOf(id, "c1", s.text)) : s.text)).join("");
    expect(shown).toBe("群主张三 邀请 我 加入群聊");
  });

  it("sysEvent 为空/不认识 → undefined（调用方回退 sysSegments/content）", () => {
    const empty: ChatMessage = { convId: "c1", from: "", content: "老消息整句", contentType: "system", convSeq: 1, timestamp: 0, status: "received" };
    expect(buildGroupSysSegments(empty, t, "zh-Hans")).toBeUndefined();
    const unknown: ChatMessage = { ...empty, sysEvent: "some_future_event" };
    expect(buildGroupSysSegments(unknown, t, "zh-Hans")).toBeUndefined();
  });

  it("候选人名段数量不足（脏数据）→ 缺的槽位留空文本，不崩", () => {
    const m: ChatMessage = {
      convId: "c1", from: "", content: "", contentType: "system", convSeq: 1, timestamp: 0, status: "received",
      sysEvent: "member_remove", sysSegments: [{ uid: "1001", text: "群主张三" }], // 只给了 actor，没给 target
    };
    const segs = buildGroupSysSegments(m, t, "zh-Hans");
    expect(segs?.map((s) => s.text).join("")).toBe("群主张三 将  移出群聊");
  });
});

// 系统通知单聊（登录/改密/被踢下线）：无 sysSegments，按 sys_args 拼多行文本。
describe("buildSysNoticeText", () => {
  it("new_device_login：正常地点、无异地告警", () => {
    const m: ChatMessage = {
      convId: "c1", from: "777000", content: "", contentType: "text", convSeq: 1, timestamp: 0, status: "received",
      sysEvent: "new_device_login", sysArgs: { at: "2026-09-22T10:00:00Z", platform: "ios", device: "iPhone 16" },
    };
    const zh = buildSysNoticeText(m, t, "zh-Hans");
    expect(zh).toContain("· iPhone 16 · ios");
    expect(zh).toContain("如非本人操作");
    expect(zh?.split("\n")).toHaveLength(3); // 首行 + 设备行 + 尾行（无 ip/familiars）
  });

  it("new_device_login：异地登录带常用地，familiars 按语言拼接", () => {
    const m: ChatMessage = {
      convId: "c1", from: "777000", content: "", contentType: "text", convSeq: 1, timestamp: 0, status: "received",
      sysEvent: "new_device_login",
      sysArgs: { at: "2026-09-22T10:00:00Z", province: "广东", unusual: "1", ip: "1.2.3.4", familiars: "北京,上海" },
    };
    const zh = buildSysNoticeText(m, t, "zh-Hans")!;
    expect(zh).toMatch(/^⚠ 你的账号于 .+ 在【广东】登录：/);
    expect(zh).toContain("· IP 1.2.3.4");
    expect(zh).toContain("· 常用地：北京、上海");
    setPref("en");
    const en = buildSysNoticeText(m, t, "en")!;
    expect(en).toMatch(/^⚠ Your account signed in from \[广东\] at /);
    expect(en).toContain("· Usual locations: 北京, 上海");
  });

  it("password_changed：设备行按 args.device 是否存在决定有无", () => {
    const withDevice: ChatMessage = {
      convId: "c1", from: "777000", content: "", contentType: "text", convSeq: 1, timestamp: 0, status: "received",
      sysEvent: "password_changed", sysArgs: { at: "2026-09-22T10:00:00Z", device: "Chrome · macOS" },
    };
    expect(buildSysNoticeText(withDevice, t, "zh-Hans")?.split("\n")).toHaveLength(3);
    const noDevice: ChatMessage = { ...withDevice, sysArgs: { at: "2026-09-22T10:00:00Z" } };
    expect(buildSysNoticeText(noDevice, t, "zh-Hans")?.split("\n")).toHaveLength(2);
  });

  it("twostep_recovery_used：剩余数代入；设备行有才显；中英文都渲染", () => {
    const m: ChatMessage = {
      convId: "c1", from: "777000", content: "", contentType: "text", convSeq: 1, timestamp: 0, status: "received",
      sysEvent: "twostep_recovery_used", sysArgs: { left: "7", at: "2026-10-29T10:00:00Z", device: "Chrome · macOS" },
    };
    const zhText = buildSysNoticeText(m, t, "zh-Hans")!;
    expect(zhText.split("\n")).toHaveLength(3);
    expect(zhText).toContain("剩余 7 个恢复码");
    expect(zhText).toContain("· 登录设备：Chrome · macOS");
    expect(buildSysNoticeText({ ...m, sysArgs: { left: "0", at: "2026-10-29T10:00:00Z" } }, t, "zh-Hans")!.split("\n")).toHaveLength(2);
    setPref("en");
    expect(buildSysNoticeText(m, t, "en")).toContain("7 recovery codes left");
  });

  it("device_kicked：有 actor_device 走 by_line，没有走 time_line；device 缺省兜底", () => {
    const byActor: ChatMessage = {
      convId: "c1", from: "777000", content: "", contentType: "text", convSeq: 1, timestamp: 0, status: "received",
      sysEvent: "device_kicked", sysArgs: { target_device: "iPad", actor_device: "iPhone 16", at: "2026-09-22T10:00:00Z" },
    };
    expect(buildSysNoticeText(byActor, t, "zh-Hans")).toContain("· 操作方：iPhone 16");
    const noActor: ChatMessage = { ...byActor, sysArgs: { at: "2026-09-22T10:00:00Z" } };
    const s = buildSysNoticeText(noActor, t, "zh-Hans")!;
    expect(s).toContain("某台设备");
    expect(s).toContain("· 时间：");
  });

  it("export_ready：三行（标题 / 大小·会话·消息 / 过期时间），数值缺失不出 NaN", () => {
    const m: ChatMessage = {
      convId: "c1", from: "777000", content: "兜底整句", contentType: "text", convSeq: 1, timestamp: 0, status: "received",
      sysEvent: "export_ready", sysArgs: { size_bytes: "2048", conv_count: "3", msg_count: "42", expires_at: "2026-10-27T10:00:00Z" },
    };
    const lines = buildSysNoticeText(m, t, "zh-Hans")!.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("3");
    expect(lines[1]).toContain("42");
    expect(buildSysNoticeText({ ...m, sysArgs: undefined }, t, "zh-Hans")).not.toContain("NaN");
  });

  it("sysEvent 非三个通知事件之一 → undefined（调用方回退 content）", () => {
    const m: ChatMessage = { convId: "c1", from: "", content: "整句", contentType: "text", convSeq: 1, timestamp: 0, status: "received", sysEvent: "member_join" };
    expect(buildSysNoticeText(m, t, "zh-Hans")).toBeUndefined();
    expect(buildSysNoticeText({ ...m, sysEvent: undefined }, t, "zh-Hans")).toBeUndefined();
  });
});

// 引用快照：reply_snapshot_kind 非空按表渲染；建议场景 chat_record 带标题。
describe("localizeReplySnapshot", () => {
  it("chat_record 带标题 / 不带标题", () => {
    const titled: ChatMessage = { convId: "c1", from: "", content: "", contentType: "text", convSeq: 1, timestamp: 0, status: "received", replySnapshotKind: "chat_record", replySnapshotArgs: { title: "周末聚会" } };
    expect(localizeReplySnapshot(titled, t)).toBe("[聊天记录] 周末聚会");
    const untitled: ChatMessage = { ...titled, replySnapshotArgs: {} };
    expect(localizeReplySnapshot(untitled, t)).toBe("[聊天记录]");
    setPref("en");
    expect(localizeReplySnapshot(titled, t)).toBe("[Chat History] 周末聚会");
  });

  it("recalled / call / contact(带名/不带名) / file(带名/不带名)", () => {
    expect(localizeReplySnapshot({ replySnapshotKind: "recalled" } as Snap, t)).toBe("[已撤回的消息]");
    expect(localizeReplySnapshot({ replySnapshotKind: "call" } as Snap, t)).toBe("[音视频通话]");
    expect(localizeReplySnapshot({ replySnapshotKind: "contact", replySnapshotArgs: { name: "小明" } } as Snap, t)).toBe("[个人名片] 小明");
    expect(localizeReplySnapshot({ replySnapshotKind: "contact" } as Snap, t)).toBe("[个人名片]");
    expect(localizeReplySnapshot({ replySnapshotKind: "file", replySnapshotArgs: { name: "报表.xlsx" } } as Snap, t)).toBe("[文件] 报表.xlsx");
    expect(localizeReplySnapshot({ replySnapshotKind: "file" } as Snap, t)).toBe("[文件]");
  });

  it("voice：duration_ms 转 m:ss，复用 formatMediaDuration 不再自己拼", () => {
    expect(localizeReplySnapshot({ replySnapshotKind: "voice", replySnapshotArgs: { duration_ms: "7000" } } as Snap, t)).toBe("[语音] 0:07");
    expect(localizeReplySnapshot({ replySnapshotKind: "voice", replySnapshotArgs: { duration_ms: "65000" } } as Snap, t)).toBe("[语音] 1:05");
  });

  it("other：按 args.content_type 分流 image/video；罕见其余类型回退旧 bracket 文本", () => {
    expect(localizeReplySnapshot({ replySnapshotKind: "other", replySnapshotArgs: { content_type: "image" } } as Snap, t)).toBe("[图片]");
    expect(localizeReplySnapshot({ replySnapshotKind: "other", replySnapshotArgs: { content_type: "video" } } as Snap, t)).toBe("[视频]");
    expect(localizeReplySnapshot({ replySnapshotKind: "other", replySnapshotArgs: {}, replySnapshot: "[file] a.txt" } as Snap, t)).toBe("[文件] a.txt");
  });

  it("kind 缺失（老消息）→ 回退 replySnapshot 字符串本地化；空快照 → 空串", () => {
    expect(localizeReplySnapshot({ replySnapshot: "[image]" } as Snap, t)).toBe("[图片]");
    setPref("en");
    expect(localizeReplySnapshot({ replySnapshot: "[image]" } as Snap, t)).toBe("[Photo]");
    expect(localizeReplySnapshot({} as Snap, t)).toBe("");
  });
});

// 真实 bug：localizeSnippet 此前硬编码中文输出，不看 App 当前语言（英文界面下引用条一直显中文）。
describe("localizeSnippet（P3 修复：读 App 语言而非硬编码中文）", () => {
  it("默认（不传 translate）走模块级 t()，随 setPref 切换", () => {
    expect(localizeSnippet("[video]")).toBe("[视频]");
    setPref("en");
    expect(localizeSnippet("[video]")).toBe("[Video]");
  });
  it("[file] 带原名 → quote.snapshot.file_named（不再是硬编码「[文件] 」前缀）", () => {
    expect(localizeSnippet("[file] 报表.xlsx", t)).toBe("[文件] 报表.xlsx");
    setPref("en");
    expect(localizeSnippet("[file] report.xlsx", t)).toBe("[File] report.xlsx");
  });
  it("[chat_record]/[call]/[contact] 裸 token 兜底也随语言走", () => {
    setPref("en");
    expect(localizeSnippet("[chat_record]", t)).toBe("[Chat History]");
    expect(localizeSnippet("[call]", t)).toBe("[Call]");
    expect(localizeSnippet("[contact]", t)).toBe("[Contact]");
  });
  it("非 bracket-token 的普通文本原样透传", () => {
    expect(localizeSnippet("普通引用文本", t)).toBe("普通引用文本");
  });
});
