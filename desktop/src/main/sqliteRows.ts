// SQLite 侧的表结构与「行 ↔ 记录」映射（D4-3b）。
//
// **权威契约在 im-web 的 `src/sdk/localStore.types.ts`**，本文件是它在关系表上的落法。
// 两边不能共用同一份源码：`localStore.types.ts` 的传递依赖会把 `protocol.ts` / `mention.ts` /
// `listSearch.ts` 一起拖进主进程的编译单元（实测 TS6059 + 依赖图），那等于让主进程去编译
// 浏览器侧代码，与 DESKTOP_DESIGN §7.4「两套独立依赖树」冲突。
// **代价是这里有一份平行实现**，护栏是两侧共跑的 `localStore.contract.ts`——
// 类型这一侧也钉住了：`test/sqliteStore.contract.test.ts` 里那句
// `const store: LocalStore = createSqliteStore(...)` 会在类型检查期发现签名漂移。
//
// ⚠️ 改这里的列或判据前，先读 im-web 那份 types.ts 的注释；那里每条都记着一次真实事故。

import type { Database } from "better-sqlite3";

/** 一条落库消息。字段名与 im-web 的 `MsgRecord` 一一对应（列名转 snake_case）。 */
export interface MsgRecord {
  id: string;
  owner: string;
  convId: string;
  convSeq: number;
  from: string;
  fromNickname?: string;
  fromRole?: string;
  content: string;
  contentType: string;
  fileName?: string;
  fileSize?: number;
  caption?: string;
  mentions?: string[];
  mentionSpans?: { offset: number; length: number; uid: string }[];
  mentionAll?: boolean;
  sysSegments?: { uid?: string; text: string }[];
  timestamp: number;
  serverMsgId?: string;
  clientMsgId?: string;
  status?: "failed";
  note?: string;
  recalledAt?: number;
  recalledBy?: string;
  editedAt?: number;
  pinnedAt?: number;
  replyToConvSeq?: number;
  replySnapshot?: string;
  replyToFrom?: string;
  forwardFrom?: string;
  groupId?: string;
  posterUrl?: string;
  mediaW?: number;
  mediaH?: number;
  duration?: number;
  thumb?: string;
  waveform?: string;
}

export interface SeqRange { lo: number; hi: number }

/**
 * 建表。
 *
 * **`conv_seq` 必须是 INTEGER 不是 TEXT**：读回按 `ORDER BY conv_seq` 排，落在 TEXT 列上
 * 就是字典序，第 10 条会排到第 2 条前面。契约里「按 conv_seq **数值**升序载回」那条用
 * 1/2/10 就是为了在这里报警（web 侧曾因个位数序号的字典序恰好等于数字序而漏掉这个洞）。
 *
 * **三个 search_* 列存的是小写后的原文**，用于 `LIKE` 子串匹配。为什么不在查询时用 SQL 的
 * `lower()`：它只认 ASCII，`lower('Äpfel')` 原样返回，于是「ÄPFEL」搜不到「äpfel」**且不报错**
 * ——正是 §7.6.1 否掉 FTS5 的同一种静默失效。落库时用 JS 的 `toLowerCase()` 算好，
 * 判据就与 web 侧的 `toLowerCase().includes()` 逐字相同。
 * 三列分开而不拼成一列：拼接需要分隔符，而含分隔符的查询词会跨字段假命中；
 * 分开存 = 与 JS 里「三个字段各自 includes」逐字同构。
 */
export function createSchema(db: Database): void {
  db.pragma("journal_mode = WAL");   // 崩溃安全 + 读写不互斥；主进程独占这个库
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id                TEXT PRIMARY KEY,
      owner             TEXT NOT NULL,
      conv_id           TEXT NOT NULL,
      conv_seq          INTEGER NOT NULL,
      from_uid          TEXT NOT NULL,
      from_nickname     TEXT,
      from_role         TEXT,
      content           TEXT NOT NULL,
      content_type      TEXT NOT NULL,
      file_name         TEXT,
      file_size         INTEGER,
      caption           TEXT,
      mentions          TEXT,
      mention_spans     TEXT,
      mention_all       INTEGER,
      sys_segments      TEXT,
      timestamp         INTEGER NOT NULL,
      server_msg_id     TEXT,
      client_msg_id     TEXT,
      status            TEXT,
      note              TEXT,
      recalled_at       INTEGER,
      recalled_by       TEXT,
      edited_at         INTEGER,
      pinned_at         INTEGER,
      reply_to_conv_seq INTEGER,
      reply_snapshot    TEXT,
      reply_to_from     TEXT,
      forward_from      TEXT,
      group_id          TEXT,
      poster_url        TEXT,
      media_w           INTEGER,
      media_h           INTEGER,
      duration          INTEGER,
      thumb             TEXT,
      waveform          TEXT,
      search_content    TEXT NOT NULL DEFAULT '',
      search_caption    TEXT NOT NULL DEFAULT '',
      search_file_name  TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(owner, conv_id, conv_seq);
    CREATE INDEX IF NOT EXISTS idx_messages_owner ON messages(owner);

    CREATE TABLE IF NOT EXISTS deletions (
      id      TEXT PRIMARY KEY,
      owner   TEXT NOT NULL,
      conv_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deletions_conv ON deletions(owner, conv_id);

    CREATE TABLE IF NOT EXISTS sync_cursors (
      id       TEXT PRIMARY KEY,
      owner    TEXT NOT NULL,
      conv_id  TEXT NOT NULL,
      conv_seq INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conv_ranges (
      id      TEXT PRIMARY KEY,
      owner   TEXT NOT NULL,
      conv_id TEXT NOT NULL,
      ranges  TEXT NOT NULL,
      head    INTEGER NOT NULL DEFAULT 0
    );
  `);
}

/** SQLite 只认 null，不认 undefined。写入前统一转换。 */
const n = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
/** 反向：读回时 NULL → undefined。**不能留 null**——契约按 `undefined` 逐字段比对。 */
const u = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
const json = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));
function parse<T>(v: string | null): T | undefined {
  if (v === null) return undefined;
  try { return JSON.parse(v) as T; } catch { return undefined; }
}

/**
 * 「哪几段文本参与搜索命中」——与 im-web `localStore.types.ts#searchableFields` **必须一致**。
 * content 仅 text 消息参与（媒体/文件的 content 是 URL，参与的话搜索词撞上 URL 片段
 * 会命中一条看不见文字的消息）；caption 与 fileName 任意类型都参与。
 */
export function searchableFields(rec: MsgRecord): { content: string; caption: string; fileName: string } {
  const isText = !rec.contentType || rec.contentType === "text";
  return { content: isText ? rec.content ?? "" : "", caption: rec.caption ?? "", fileName: rec.fileName ?? "" };
}

/** 记录 → 行（含三个小写检索列）。列顺序与 `INSERT` 的占位符严格对应。 */
export function toRow(rec: MsgRecord): Record<string, unknown> {
  const f = searchableFields(rec);
  return {
    id: rec.id, owner: rec.owner, conv_id: rec.convId, conv_seq: rec.convSeq,
    from_uid: rec.from, from_nickname: n(rec.fromNickname), from_role: n(rec.fromRole),
    content: rec.content ?? "", content_type: rec.contentType ?? "",
    file_name: n(rec.fileName), file_size: n(rec.fileSize), caption: n(rec.caption),
    mentions: json(rec.mentions), mention_spans: json(rec.mentionSpans),
    mention_all: rec.mentionAll === undefined ? null : rec.mentionAll ? 1 : 0,
    sys_segments: json(rec.sysSegments),
    timestamp: rec.timestamp, server_msg_id: n(rec.serverMsgId), client_msg_id: n(rec.clientMsgId),
    status: n(rec.status), note: n(rec.note),
    recalled_at: n(rec.recalledAt), recalled_by: n(rec.recalledBy),
    edited_at: n(rec.editedAt), pinned_at: n(rec.pinnedAt),
    reply_to_conv_seq: n(rec.replyToConvSeq), reply_snapshot: n(rec.replySnapshot),
    reply_to_from: n(rec.replyToFrom), forward_from: n(rec.forwardFrom),
    group_id: n(rec.groupId), poster_url: n(rec.posterUrl),
    media_w: n(rec.mediaW), media_h: n(rec.mediaH), duration: n(rec.duration),
    thumb: n(rec.thumb), waveform: n(rec.waveform),
    search_content: f.content.toLowerCase(),
    search_caption: f.caption.toLowerCase(),
    search_file_name: f.fileName.toLowerCase(),
  };
}

type Row = Record<string, never>;

/** 行 → 记录。NULL 一律还原成 `undefined`（契约按 undefined 比对，留 null 会全线不等）。 */
export function fromRow(row: unknown): MsgRecord {
  const r = row as Record<string, string & number & null>;
  return {
    id: r.id, owner: r.owner, convId: r.conv_id, convSeq: r.conv_seq,
    from: r.from_uid, fromNickname: u(r.from_nickname), fromRole: u(r.from_role),
    content: r.content, contentType: r.content_type,
    fileName: u(r.file_name), fileSize: u(r.file_size), caption: u(r.caption),
    mentions: parse<string[]>(r.mentions),
    mentionSpans: parse<MsgRecord["mentionSpans"]>(r.mention_spans) as MsgRecord["mentionSpans"],
    mentionAll: r.mention_all === null ? undefined : r.mention_all === 1,
    sysSegments: parse<MsgRecord["sysSegments"]>(r.sys_segments) as MsgRecord["sysSegments"],
    timestamp: r.timestamp, serverMsgId: u(r.server_msg_id), clientMsgId: u(r.client_msg_id),
    status: u(r.status) as "failed" | undefined, note: u(r.note),
    recalledAt: u(r.recalled_at), recalledBy: u(r.recalled_by),
    editedAt: u(r.edited_at), pinnedAt: u(r.pinned_at),
    replyToConvSeq: u(r.reply_to_conv_seq), replySnapshot: u(r.reply_snapshot),
    replyToFrom: u(r.reply_to_from), forwardFrom: u(r.forward_from),
    groupId: u(r.group_id), posterUrl: u(r.poster_url),
    mediaW: u(r.media_w), mediaH: u(r.media_h), duration: u(r.duration),
    thumb: u(r.thumb), waveform: u(r.waveform),
  };
}

export const COLUMNS = [
  "id", "owner", "conv_id", "conv_seq", "from_uid", "from_nickname", "from_role",
  "content", "content_type", "file_name", "file_size", "caption",
  "mentions", "mention_spans", "mention_all", "sys_segments", "timestamp",
  "server_msg_id", "client_msg_id", "status", "note",
  "recalled_at", "recalled_by", "edited_at", "pinned_at",
  "reply_to_conv_seq", "reply_snapshot", "reply_to_from", "forward_from",
  "group_id", "poster_url", "media_w", "media_h", "duration", "thumb", "waveform",
  "search_content", "search_caption", "search_file_name",
] as const;

export type { Row };
