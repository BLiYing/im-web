// P3 客户端消费：把服务端下发的 sys_event/sys_args（群系统消息 + 系统通知单聊）与
// reply_snapshot_kind/reply_snapshot_args（引用快照）按 App 当前语言渲染成整句。
//
// 权威表与算法见 ../IMServer docs/PROTOCOL.md §4.3/§6.6 与 scratchpad/p3-client-guide.md §1/§2：
// **不在这里拼句子结构**——文案键本身带 {占位符}，这里只做「按占位符类型分流替换」（tokenizeTemplate），
// 中英文语序差异交给文案表，不写进 TS 模板字符串。
//
// 三块产出，两条渲染管线复用：
//   ① buildGroupSysSegments  —— 群系统消息：产出与服务端 sysSegments 同构的 {uid,text}[]，
//      聊天页喂给 MessageList 的 renderSysLine、会话列表预览喂给 convPreview 的同一段 map/join——
//      两处都在各自现有代码里再套一层 sysSegmentName（"我" 自称）+ localNameOf（备注>群昵称>昵称）。
//   ② buildSysNoticeText     —— 系统通知单聊（登录/改密/被踢下线）：无人名段，直接拼多行文本。
//   ③ localizeReplySnapshot  —— 引用条快照：kind 非空按表渲染；为空回退旧 replySnapshot 字符串
//      （该回退路径本身也要读 App 语言，不能再硬编码中文——这是本批顺手修的真实 bug，见 messageContent.ts）。
//
// sysEvent/replySnapshotKind 为空或不认识 → 全部返回 undefined，调用方回退老的 sysSegments/content/
// replySnapshot 路径（现有代码，不改）。
import type { ChatMessage, SysSegment } from "./sdk/protocol";
import { sysSegmentName } from "./sysSegments";
import { tokenizeTemplate, type Args, type Lang } from "./i18n";
import { fullDateTime } from "./time";
import { formatMediaDuration } from "./media";
import { localizeSnippet } from "./messageContent";

type Translate = (key: string, args?: Args) => string;

interface SysEventDef {
  key: string;
  /** 占位符名 → 该占位符消费 sysSegments 里第几个带 uid 的候选人名（按出现顺序）。 */
  slots: string[];
}

/** §1.1 权威表：群系统消息事件 → 文案键 → 人名槽位。照抄 p3-client-guide.md，别自己再定义一遍。 */
const GROUP_SYS_EVENTS: Record<string, SysEventDef> = {
  group_create: { key: "sys.group.create", slots: ["owner"] },
  member_invite: { key: "sys.group.member_invite", slots: ["actor"] }, // 其余候选人是被邀请者，见 §1.3
  member_join: { key: "sys.group.member_join", slots: ["actor"] },
  member_leave: { key: "sys.group.member_leave", slots: ["actor"] },
  member_remove: { key: "sys.group.member_remove", slots: ["actor", "target"] },
  member_remove_ban: { key: "sys.group.member_remove_ban", slots: ["actor", "target"] },
  role_admin_set: { key: "sys.group.role_admin_set", slots: ["target"] },
  role_admin_revoked: { key: "sys.group.role_admin_revoked", slots: ["target"] },
  owner_transfer: { key: "sys.group.owner_transfer", slots: ["target"] },
  group_rename: { key: "sys.group.rename", slots: [] },
  group_avatar: { key: "sys.group.avatar", slots: ["actor"] },
  announcement: { key: "sys.group.announcement", slots: ["actor"] },
  mute_all_on: { key: "sys.group.mute_all_on", slots: [] },
  mute_all_off: { key: "sys.group.mute_all_off", slots: [] },
  mute_member: { key: "sys.group.mute_member", slots: ["actor", "target"] },
  unmute_member: { key: "sys.group.unmute_member", slots: ["actor", "target"] },
};

/** §1.3：多人名单按语言习惯拼接的分隔符（zh 顿号，en 逗号+空格，不做 "A, B and C" 语法优化）。 */
function joinNames(names: string[], lang: Lang): string {
  return names.join(lang === "en" ? ", " : "、");
}

/**
 * §1.2 通用算法：把一条群系统消息的 sysEvent/sysArgs/sysSegments 渲染成与服务端 sysSegments
 * 同构的分段数组。返回 undefined = 事件为空/不认识 → 调用方回退现有的 m.sysSegments/content 路径。
 *
 * `localNameOf`/`selfUid`/`lang` 只在 member_invite 拼 `names`（§1.3）时用到——其余人名槽位
 * （actor/target）沿用候选段自身的服务端字面兜底，真正的本地显示名解析交给调用方现有的渲染
 * 管线（renderSysLine 的 sysSegmentName+localNameOf、convPreview 的同款 map），不在这里重复解析。
 */
export function buildGroupSysSegments(
  m: Pick<ChatMessage, "sysEvent" | "sysArgs" | "sysSegments" | "convId">,
  t: Translate,
  selfUid: string,
  localNameOf: (uid: string, convId: string, fallback?: string) => string,
  lang: Lang,
): SysSegment[] | undefined {
  const ev = m.sysEvent;
  if (!ev) return undefined;
  const def = GROUP_SYS_EVENTS[ev];
  if (!def) return undefined;
  const candidates = (m.sysSegments ?? []).filter((s): s is SysSegment & { uid: string } => !!s.uid);
  const args: Record<string, string> = { ...(m.sysArgs ?? {}) };
  if (ev === "member_invite") {
    const invitees = candidates
      .slice(1) // 第 1 个候选是邀请人（actor 槽位），其余是被邀请者
      .map((s) => sysSegmentName(s.uid, selfUid, (id) => localNameOf(id, m.convId ?? "", s.text)));
    args.names = joinNames(invitees, lang);
  }
  const tokens = tokenizeTemplate(t(def.key)); // t(key) 不传 args = 原始未替换串（见 i18n/index.ts）
  let nextCandidate = 0;
  const out: SysSegment[] = [];
  for (const tok of tokens) {
    if (tok.type === "text") {
      if (tok.value) out.push({ text: tok.value });
      continue;
    }
    if (def.slots.includes(tok.name)) {
      const cand = candidates[nextCandidate++];
      out.push(cand ? { uid: cand.uid, text: cand.text } : { text: "" }); // 候选不足：脏数据安全，留空不崩
    } else {
      out.push({ text: args[tok.name] ?? "" });
    }
  }
  return out.length > 0 ? out : undefined;
}

/** RFC3339 → 本地习惯的「年月日 时:分」；解析失败（脏数据/老格式）原样透传，不崩、不空白。 */
function formatNoticeAt(rfc3339: string | undefined): string {
  if (!rfc3339) return "";
  const ms = Date.parse(rfc3339);
  return Number.isFinite(ms) ? fullDateTime(ms) : rfc3339;
}

/**
 * §1.4：系统通知单聊（登录/改密/被踢下线）——没有 sysSegments，按 sys_args 拼多行文本
 * （对齐服务端 buildXxxNoticeText 的行结构，`\n` 连接）。返回 undefined = 非这三个事件之一
 * → 调用方回退显示 content（服务端预生成的整句，现有行为不变）。
 */
export function buildSysNoticeText(
  m: Pick<ChatMessage, "sysEvent" | "sysArgs">,
  t: Translate,
  lang: Lang,
): string | undefined {
  const ev = m.sysEvent;
  const args = m.sysArgs ?? {};
  if (ev === "new_device_login") {
    const at = formatNoticeAt(args.at);
    const lines: string[] = [];
    lines.push(
      args.unusual === "1" && args.province
        ? t("sys.notice.new_device.headline_unusual", { at, province: args.province })
        : t("sys.notice.new_device.headline_normal", { at }),
    );
    const device = args.device || t("device.platform.unknown");
    lines.push(
      args.platform
        ? t("sys.notice.new_device.device_platform_line", { device, platform: args.platform })
        : t("sys.notice.new_device.device_line", { device }),
    );
    if (args.ip) lines.push(t("sys.notice.new_device.ip_line", { ip: args.ip }));
    if (args.unusual === "1" && args.familiars) {
      const familiars = joinNames(args.familiars.split(",").map((s) => s.trim()).filter(Boolean), lang);
      lines.push(t("sys.notice.new_device.familiars_line", { familiars }));
    }
    lines.push(t("sys.notice.new_device.footer"));
    return lines.join("\n");
  }
  if (ev === "password_changed") {
    const lines = [t("sys.notice.password_changed.headline", { at: formatNoticeAt(args.at) })];
    if (args.device) lines.push(t("sys.notice.password_changed.device_line", { device: args.device }));
    lines.push(t("sys.notice.password_changed.footer"));
    return lines.join("\n");
  }
  if (ev === "device_kicked") {
    const device = args.target_device || t("common.unknown_device_kicked");
    const at = formatNoticeAt(args.at);
    const lines = [t("sys.notice.device_kicked.headline", { device })];
    lines.push(
      args.actor_device
        ? t("sys.notice.device_kicked.by_line", { actor: args.actor_device, at })
        : t("sys.notice.device_kicked.time_line", { at }),
    );
    lines.push(t("sys.notice.device_kicked.footer"));
    return lines.join("\n");
  }
  return undefined;
}

/**
 * §2：引用快照按 replySnapshotKind 本地化。`kind` 非空就优先用它；为空（纯文本引用/老消息）回退
 * `replySnapshot` 字符串——该回退路径本身也改成读 App 语言（localizeSnippet 已改用 t()，不再硬编码中文）。
 */
export function localizeReplySnapshot(
  m: Pick<ChatMessage, "replySnapshotKind" | "replySnapshotArgs" | "replySnapshot">,
  t: Translate,
): string {
  const kind = m.replySnapshotKind;
  const args = m.replySnapshotArgs ?? {};
  switch (kind) {
    case "recalled":
      return t("quote.snapshot.recalled");
    case "chat_record":
      return args.title ? t("quote.snapshot.chat_record_titled", { title: args.title }) : t("quote.snapshot.chat_record");
    case "file":
      return args.name ? t("quote.snapshot.file_named", { name: args.name }) : t("preview.file");
    case "voice":
      return t("preview.voice_duration", { duration: formatMediaDuration(Number(args.duration_ms) || 0) || "0:00" });
    case "contact":
      return args.name ? t("quote.snapshot.contact_named", { name: args.name }) : t("quote.snapshot.contact");
    case "call":
      return t("quote.snapshot.call");
    case "other":
      if (args.content_type === "image") return t("preview.image");
      if (args.content_type === "video") return t("preview.video");
      return localizeSnippet(m.replySnapshot || "", t);
    default:
      return localizeSnippet(m.replySnapshot || "", t);
  }
}
