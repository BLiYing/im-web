// 本地消息库的**主进程 SQLite 实现**（D4-3b）。契约见 im-web 的 `src/sdk/localStore.types.ts`
// ——那里每个方法的注释都记着一次真实事故，改行为前先读。
//
// 为什么在主进程：`better-sqlite3` 是原生模块，而渲染进程 contextIsolation + 无 nodeIntegration
// （DESKTOP_DESIGN §7.3 ②），库只能落这一侧，页面经桥调用（§7.6.3）。
//
// **三处与 im-web 平行的纯逻辑**（合并白名单 / 搜索字段规则 / 区间代数）在本文件与
// `sqliteRows.ts` 里各有一份。这不是疏忽，是 §7.4 那条「两套独立依赖树」的代价：
// 共用源码会把 protocol/mention/listSearch 拖进主进程的编译单元（实测 TS6059）。
// 护栏是两侧共跑的 `localStore.contract.ts`——它对这三处都有正反两向的断言。
//
// **同步 API 包在 async 外壳里**：better-sqlite3 是同步的，而契约全是 Promise（IndexedDB
// 本来就异步、跨进程更是）。同步在主进程这一侧反而是优点：读-改-写可以直接放进一个事务，
// 不必为并发去做乐观锁。
//
// **失败只降级、绝不抛**（契约③）：持久化是增强。任何一个方法把异常抛回渲染进程，
// 都会让收发主流程跟着断。

import DatabaseCtor from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { COLUMNS, createSchema, fromRow, toRow, type MsgRecord, type SeqRange } from "./sqliteRows";

/** 落库前的入参形状（对应 im-web 的 `ChatMessage`，只列本实现读的字段）。 */
export interface ChatMessageLike {
  convId: string;
  from: string;
  content: string;
  contentType: string;
  convSeq: number;
  timestamp: number;
  fromNickname?: string;
  fromRole?: string;
  fileName?: string;
  fileSize?: number;
  caption?: string;
  mentions?: string[];
  mentionSpans?: { offset: number; length: number; uid: string }[];
  mentionAll?: boolean;
  sysSegments?: { uid?: string; text: string }[];
  serverMsgId?: string;
  clientMsgId?: string;
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

interface MsgOpPatch {
  recalledAt?: number;
  recalledBy?: string;
  editedAt?: number;
  pinnedAt?: number;
  content?: string;
}

export type StoreWarn = (event: string, fields: Record<string, unknown>) => void;

const keyOf = (owner: string, convId: string, convSeq: number): string => `${owner}|${convId}|${convSeq}`;
const rejectedKeyOf = (owner: string, convId: string, cid: string): string => `${owner}|${convId}|c:${cid}`;
const cursorKeyOf = (owner: string, convId: string): string => `${owner}|${convId}`;

// ---- 区间代数：与 im-web `src/sdk/ranges.ts` 的 normalizeRanges / addRange 同语义 ----

function normalizeRanges(ranges: SeqRange[]): SeqRange[] {
  const valid = ranges
    .filter((r) => Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.lo >= 1 && r.hi >= r.lo)
    .sort((a, b) => a.lo - b.lo);
  const out: SeqRange[] = [];
  for (const r of valid) {
    const last = out[out.length - 1];
    // `<= last.hi + 1`：相邻（不只是重叠）也要并——[1,3] 与 [4,6] 之间没有缺口。
    if (last && r.lo <= last.hi + 1) {
      if (r.hi > last.hi) last.hi = r.hi;
    } else {
      out.push({ lo: r.lo, hi: r.hi });
    }
  }
  return out;
}

function addRange(ranges: SeqRange[], lo: number, hi: number): SeqRange[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo || hi < 1) return normalizeRanges(ranges);
  return normalizeRanges([...ranges, { lo: Math.max(1, lo), hi }]);
}

/**
 * 稀疏重放的合并规则——与 im-web `localStore.types.ts#mergeRecords` **必须逐字一致**。
 * 这 5 个字段不许被后到的稀疏负载覆盖，其余以最后一次写入为准。
 * 契约里正反两条断言都盯着它（「稀疏重放」与「受保护的只有那 5 个」）。
 */
function mergeRecords(existing: MsgRecord | undefined, rec: MsgRecord): MsgRecord {
  return {
    ...existing,
    ...rec,
    fileName: rec.fileName || existing?.fileName,
    fromNickname: rec.fromNickname || existing?.fromNickname,
    fromRole: rec.fromRole || existing?.fromRole,
    fileSize: rec.fileSize !== undefined && rec.fileSize > 0 ? rec.fileSize : existing?.fileSize ?? rec.fileSize,
    serverMsgId: rec.serverMsgId || existing?.serverMsgId,
  };
}

/** `LIKE` 的元字符转义。不转的话搜「100%」会变成通配、搜「a_b」会匹配「axb」。 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function messageRecord(owner: string, m: ChatMessageLike): MsgRecord {
  return {
    id: keyOf(owner, m.convId, m.convSeq),
    owner, convId: m.convId, convSeq: m.convSeq,
    from: m.from, fromNickname: m.fromNickname, fromRole: m.fromRole,
    content: m.content, contentType: m.contentType,
    fileName: m.fileName, fileSize: m.fileSize, caption: m.caption,
    mentions: m.mentions, mentionSpans: m.mentionSpans, mentionAll: m.mentionAll,
    sysSegments: m.sysSegments, timestamp: m.timestamp, serverMsgId: m.serverMsgId,
    recalledAt: m.recalledAt, recalledBy: m.recalledBy, editedAt: m.editedAt, pinnedAt: m.pinnedAt,
    replyToConvSeq: m.replyToConvSeq, replySnapshot: m.replySnapshot,
    replyToFrom: m.replyToFrom, forwardFrom: m.forwardFrom,
    groupId: m.groupId, posterUrl: m.posterUrl,
    mediaW: m.mediaW, mediaH: m.mediaH, duration: m.duration, thumb: m.thumb, waveform: m.waveform,
  };
}

/** 读回 ChatMessage：被拒（convSeq=0）与已确认是两套还原，与 web 侧 `loadConversation` 一一对应。 */
function toChatMessage(r: MsgRecord): ChatMessageLike & { status: "failed" | "received" } {
  const media = {
    convId: r.convId, from: r.from, fromNickname: r.fromNickname, fromRole: r.fromRole,
    content: r.content, contentType: r.contentType, fileName: r.fileName, fileSize: r.fileSize,
    caption: r.caption, mentions: r.mentions, mentionSpans: r.mentionSpans, mentionAll: r.mentionAll,
    timestamp: r.timestamp,
    replyToConvSeq: r.replyToConvSeq, replySnapshot: r.replySnapshot,
    replyToFrom: r.replyToFrom, forwardFrom: r.forwardFrom,
    groupId: r.groupId, posterUrl: r.posterUrl,
    mediaW: r.mediaW, mediaH: r.mediaH, duration: r.duration, thumb: r.thumb, waveform: r.waveform,
  };
  return r.status === "failed"
    ? { ...media, clientMsgId: r.clientMsgId, convSeq: 0, status: "failed" as const, note: r.note }
    : {
        ...media,
        serverMsgId: r.serverMsgId ?? r.id,  // 老记录无此字段则回退复合键（与 web 侧同）
        sysSegments: r.sysSegments,
        convSeq: r.convSeq, status: "received" as const,
        recalledAt: r.recalledAt, recalledBy: r.recalledBy, editedAt: r.editedAt, pinnedAt: r.pinnedAt,
      };
}

/** 打开（或新建）一个本地库并返回实现。`path` 传 `:memory:` 即内存库（契约测试用）。 */
export function createSqliteStore(path: string, onWarn?: StoreWarn) {
  const db: Database = new DatabaseCtor(path);
  createSchema(db);
  const warn: StoreWarn = onWarn ?? ((event, fields) => {
    process.stderr.write(`[im-desktop] store ${event} ${JSON.stringify(fields)}\n`);
  });

  const insertSql = `INSERT INTO messages (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map((c) => `@${c}`).join(", ")})
    ON CONFLICT(id) DO UPDATE SET ${COLUMNS.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ")}`;
  const insertMsg = db.prepare(insertSql);
  const getMsg = db.prepare("SELECT * FROM messages WHERE id = ?");

  /** 读-改-写一条消息：合并规则与 web 侧共用同一段逻辑（`mergeRecords`），不在 SQL 里翻译。
   *  用 `COALESCE`/`NULLIF` 把它译成 UPSERT 也做得到，但那是第二份真相源、且写反了不报错。 */
  const putMerged = (rec: MsgRecord): void => {
    const existing = getMsg.get(rec.id);
    insertMsg.run(toRow(mergeRecords(existing ? fromRow(existing) : undefined, rec)));
  };

  const bumpCursor = db.prepare(`
    INSERT INTO sync_cursors (id, owner, conv_id, conv_seq) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET conv_seq = MAX(sync_cursors.conv_seq, excluded.conv_seq)`);
  const getCursor = db.prepare("SELECT conv_seq FROM sync_cursors WHERE id = ?");
  const getRanges = db.prepare("SELECT ranges, head FROM conv_ranges WHERE id = ?");
  const putRanges = db.prepare(`
    INSERT INTO conv_ranges (id, owner, conv_id, ranges, head) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET ranges = excluded.ranges, head = excluded.head`);

  /** 读区间行（不含老库回退，那是 loadRanges 的事）。 */
  const readRanges = (owner: string, convId: string): { ranges: SeqRange[]; head: number } | null => {
    const row = getRanges.get(cursorKeyOf(owner, convId)) as { ranges: string; head: number } | undefined;
    if (!row) return null;
    let parsed: SeqRange[] = [];
    try { parsed = JSON.parse(row.ranges) as SeqRange[]; } catch { parsed = []; }
    return { ranges: normalizeRanges(parsed), head: Math.max(0, Number(row.head) || 0) };
  };

  const writeRanges = (owner: string, convId: string, ranges: SeqRange[], head: number): void => {
    putRanges.run(cursorKeyOf(owner, convId), owner, convId, JSON.stringify(ranges), head);
  };

  /** 包一层：任何异常都记 warn 并返回兜底值，绝不抛回渲染进程。 */
  function guard<T>(event: string, fields: Record<string, unknown>, fallback: T, fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      warn(event, { ...fields, error: error instanceof Error ? error.message : String(error) });
      return fallback;
    }
  }

  return {
    name: "desktop-sqlite",

    close(): void { db.close(); },

    /**
     * 库里有多少条 content 含 `needle` 的消息。**只给自检用**，刻意不进 IPC 白名单。
     *
     * ⚠️ 为什么不是「数总行数」：头一版就是 `COUNT(*) > 0`，而库在 userData 里是**持久**的——
     * 上一轮留下的几十条让这条断言恒真，把桥整个打断它照样绿（2026-09-09 变异验证当场抓到，
     * 我写的 fail-open 护栏自己就是 fail-open）。只有查**本轮那条 marker**才证明得了
     * 「这一次的消息真的经桥落进了 SQLite」。
     */
    countMessagesWithContent(needle: string): number {
      return guard("count_failed", {}, -1, () =>
        (db.prepare("SELECT COUNT(*) AS n FROM messages WHERE content LIKE ? ESCAPE '\\'")
          .get(`%${escapeLike(needle)}%`) as { n: number }).n);
    },

    async saveMessage(owner: string, m: ChatMessageLike): Promise<void> {
      if (!owner || !m.convId || !m.convSeq || m.convSeq <= 0) return;
      guard("message_write_failed", { conv_id: m.convId, conv_seq: m.convSeq }, undefined,
        () => putMerged(messageRecord(owner, m)));
    },

    async saveIncomingMessage(owner: string, m: ChatMessageLike, advanceCursor: boolean): Promise<void> {
      if (!owner || !m.convId || !m.convSeq || m.convSeq <= 0) return;
      guard("incoming_message_write_failed", { conv_id: m.convId, conv_seq: m.convSeq }, undefined, () => {
        // 消息与游标同一个事务：崩溃时要么都成，要么游标停在旧位置下次幂等重拉，
        // 绝不会出现「游标已过、消息没落库」。
        db.transaction(() => {
          putMerged(messageRecord(owner, m));
          if (advanceCursor) bumpCursor.run(cursorKeyOf(owner, m.convId), owner, m.convId, m.convSeq);
        })();
      });
    },

    async saveIncomingPage(
      owner: string, msgs: ChatMessageLike[], advanceTo: number, rangeFrom: number, rangeTo: number, head = 0,
    ): Promise<boolean> {
      if (!owner || msgs.length === 0) return true;
      const convId = msgs[0].convId;
      const recs = msgs.filter((m) => m.convId && m.convSeq > 0).map((m) => messageRecord(owner, m));
      if (recs.length === 0) return true;
      // 整页原子：一页消息 + 游标 + 区间同一个事务。页内任一条失败则整页回滚、整页重拉。
      return guard("incoming_page_write_failed", { conv_id: convId, count: recs.length }, false, () => {
        db.transaction(() => {
          for (const rec of recs) putMerged(rec);
          if (advanceTo > 0) bumpCursor.run(cursorKeyOf(owner, convId), owner, convId, advanceTo);
          if (rangeTo >= rangeFrom && rangeTo > 0) {
            const prev = readRanges(owner, convId);
            writeRanges(owner, convId, addRange(prev?.ranges ?? [], rangeFrom, rangeTo),
              Math.max(prev?.head ?? 0, head));
          }
        })();
        return true;
      });
    },

    async saveRejected(owner: string, m: ChatMessageLike): Promise<void> {
      if (!owner || !m.convId || !m.clientMsgId) return;
      guard("message_write_failed", { conv_id: m.convId }, undefined, () => putMerged({
        ...messageRecord(owner, m),
        id: rejectedKeyOf(owner, m.convId, m.clientMsgId!),
        convSeq: 0,   // 被拒收永远拿不到 conv_seq，渲染按 timestamp 落位
        clientMsgId: m.clientMsgId, status: "failed", note: m.note,
      }));
    },

    async applyMsgOpLocal(
      owner: string, convId: string, convSeq: number, patch: MsgOpPatch, advanceCursorTo = 0,
    ): Promise<void> {
      if (!owner || !convId || !convSeq) return;
      guard("message_operation_write_failed", { conv_id: convId, conv_seq: convSeq }, undefined, () => {
        db.transaction(() => {
          const row = getMsg.get(keyOf(owner, convId, convSeq));
          if (row) {   // 记录不存在则忽略——绝不凭空新建一行
            const rec = fromRow(row);
            if (patch.recalledAt !== undefined) rec.recalledAt = patch.recalledAt;
            if (patch.recalledBy !== undefined) rec.recalledBy = patch.recalledBy;
            if (patch.editedAt !== undefined) rec.editedAt = patch.editedAt;
            if (patch.pinnedAt !== undefined) rec.pinnedAt = patch.pinnedAt;
            if (patch.content !== undefined) {
              rec.content = patch.content;
              // @ 片段的偏移是相对**原文**的，正文一改就全错位 → 连同清空。留着的话，
              // 新正文碰巧在同一偏移有个 `@` 就会高亮出来，而且**点进去是另一个人**的资料页。
              rec.mentionSpans = undefined;
            }
            insertMsg.run(toRow(rec));   // 直接覆盖：这是就地改，不是稀疏重放，不走合并
          }
          if (advanceCursorTo > 0) bumpCursor.run(cursorKeyOf(owner, convId), owner, convId, advanceCursorTo);
        })();
      });
    },

    async markMessageDeleted(
      owner: string, convId: string, target: { convSeq?: number; clientMsgId?: string },
    ): Promise<void> {
      if (!owner || !convId) return;
      const id = target.convSeq && target.convSeq > 0
        ? keyOf(owner, convId, target.convSeq)
        : target.clientMsgId ? rejectedKeyOf(owner, convId, target.clientMsgId) : null;
      if (!id) return;   // 两个都没给 → 整体忽略（**绝不能退化成清空会话**）
      guard("message_delete_failed", { conv_id: convId }, undefined, () => {
        // 墓碑与删除同一个事务：墓碑令后续读取永久过滤掉它，故重同步重新落库也不复现。
        db.transaction(() => {
          db.prepare("INSERT OR REPLACE INTO deletions (id, owner, conv_id) VALUES (?, ?, ?)")
            .run(id, owner, convId);
          db.prepare("DELETE FROM messages WHERE id = ?").run(id);
        })();
      });
    },

    async clearMessages(owner: string, convId: string): Promise<void> {
      if (!owner || !convId) return;
      // **只删消息**：墓碑与游标一概不动（删掉墓碑会让重同步把删过的消息复活）。
      guard("conversation_clear_failed", { conv_id: convId }, undefined, () => {
        db.prepare("DELETE FROM messages WHERE owner = ? AND conv_id = ?").run(owner, convId);
      });
    },

    async advanceSyncCursor(owner: string, convId: string, convSeq: number): Promise<void> {
      if (!owner || !convId || convSeq <= 0) return;
      guard("sync_cursor_write_failed", { conv_id: convId, conv_seq: convSeq }, undefined, () => {
        bumpCursor.run(cursorKeyOf(owner, convId), owner, convId, convSeq);
      });
    },

    async registerRange(
      owner: string, convId: string, lo: number, hi: number, head?: number,
    ): Promise<SeqRange[]> {
      if (!owner || !convId) return [];
      return guard("ranges_write_failed", { conv_id: convId, lo, hi }, [] as SeqRange[], () =>
        db.transaction(() => {
          const prev = readRanges(owner, convId);
          const merged = hi >= lo ? addRange(prev?.ranges ?? [], lo, hi) : normalizeRanges(prev?.ranges ?? []);
          writeRanges(owner, convId, merged, Math.max(prev?.head ?? 0, Number(head) || 0));
          return merged;
        })());
    },

    async updateRangesHead(owner: string, convId: string, head: number): Promise<void> {
      if (!owner || !convId || head <= 0) return;
      // **绝不动 ranges**——那正是「没下载就不许登记」的体现。
      guard("ranges_head_write_failed", { conv_id: convId, head }, undefined, () => {
        db.transaction(() => {
          const prev = readRanges(owner, convId);
          writeRanges(owner, convId, prev?.ranges ?? [], Math.max(prev?.head ?? 0, head));
        })();
      });
    },

    async loadConversation(owner: string, convId: string) {
      if (!owner || !convId) return [];
      return guard("conversation_load_failed", { conv_id: convId }, [], () => {
        // ORDER BY conv_seq 是**数值**序（列是 INTEGER）——落在 TEXT 列上第 10 条会排到第 2 条前。
        const rows = db.prepare(`
          SELECT m.* FROM messages m
          WHERE m.owner = ? AND m.conv_id = ?
            AND NOT EXISTS (SELECT 1 FROM deletions d WHERE d.id = m.id)
          ORDER BY m.conv_seq ASC`).all(owner, convId);
        return rows.map((r) => toChatMessage(fromRow(r)));
      });
    },

    async loadDeletedSeqs(owner: string, convId: string): Promise<number[]> {
      if (!owner || !convId) return [];
      return guard("deleted_seqs_read_failed", { conv_id: convId }, [] as number[], () => {
        const prefix = `${owner}|${convId}|`;
        const ids = db.prepare("SELECT id FROM deletions WHERE owner = ? AND conv_id = ?")
          .all(owner, convId) as { id: string }[];
        // 只取 conv_seq 型墓碑；`c:` 型是被拒消息，服务端本就不会重推。
        return ids.map((r) => r.id)
          .filter((id) => id.startsWith(prefix) && !id.startsWith(`${prefix}c:`))
          .map((id) => Number(id.slice(prefix.length)))
          .filter((v) => Number.isFinite(v) && v > 0);
      });
    },

    async loadSyncCursor(owner: string, convId: string): Promise<number> {
      if (!owner || !convId) return 0;
      return guard("sync_cursor_read_failed", { conv_id: convId }, 0, () => {
        const row = getCursor.get(cursorKeyOf(owner, convId)) as { conv_seq: number } | undefined;
        return Math.max(0, Number(row?.conv_seq) || 0);   // 无记录=0，**不从消息最大值推断**
      });
    },

    async loadRanges(owner: string, convId: string): Promise<{ ranges: SeqRange[]; head: number }> {
      if (!owner || !convId) return { ranges: [], head: 0 };
      return guard("ranges_read_failed", { conv_id: convId }, { ranges: [] as SeqRange[], head: 0 }, () => {
        const rec = readRanges(owner, convId);
        if (rec) return rec;
        // 老库兼容：没有区间行时用连续游标反推出首段 [1, cursor]。不这么做的话，
        // 升级前「从头连续拉到游标处」的用户会被判成整个会话都是缺口。
        const row = getCursor.get(cursorKeyOf(owner, convId)) as { conv_seq: number } | undefined;
        const cursor = Math.max(0, Number(row?.conv_seq) || 0);
        return { ranges: cursor > 0 ? [{ lo: 1, hi: cursor }] : [], head: 0 };
      });
    },

    async searchMessages(
      owner: string, opts: { convId?: string; q: string; limit: number },
    ): Promise<MsgRecord[]> {
      const needle = (opts.q ?? "").trim().toLowerCase();
      if (!owner || !needle || !opts.limit || opts.limit <= 0) return [];
      return guard("message_search_failed", { conv_id: opts.convId }, [] as MsgRecord[], () => {
        const like = `%${escapeLike(needle)}%`;
      // 两处 JS 侧隐式做掉、SQL 不会自动做的归一化：
      // ① 空串 convId 在 web 侧被 `if (opts.convId)` 当成"没给"=全局搜索，
      //    而 `m.conv_id = ''` 谁也匹配不上 → 静默零结果。
      // ② `LIMIT 2.5` 在 SQLite 里直接回**零行**（web 的 slice 会当 2 用）——又是搜不到但不报错。
      const conv = opts.convId || null;
      const limit = Math.floor(opts.limit);
        // 判据 = 三个小写检索列的子串（落库时用 JS 的 toLowerCase 算好，见 sqliteRows.ts）。
        // **不用 FTS5**：trigram 要 ≥3 字符，「开会」搜不到且静默失效（§7.6.1）。
        // 撤回不参与命中；墓碑走 NOT EXISTS 过滤——漏了它，用户删掉的消息会在搜索里复活。
        // 排序：时间倒序，同毫秒按 conv_seq 倒序，**再按记录键升序兜底**。
        // 最后那一级不是"排得好看"：没有唯一的最终键时，打平的行由存储顺序决定，
        // 加上 LIMIT 就会**截出与 web 不同的几条消息**——同一个搜索词两端返回不同结果集。
        // web 侧是稳定排序落在 IndexedDB 主键序上，等价于记录键升序，故这里对齐成 id ASC。
        // 打平在真实数据里够得着：被拒消息 conv_seq 恒为 0，同批落库的时间戳也可能一样。
        const rows = db.prepare(`
          SELECT m.* FROM messages m
          WHERE m.owner = ?
            AND (@conv IS NULL OR m.conv_id = @conv)
            AND (m.recalled_at IS NULL OR m.recalled_at = 0)
            AND NOT EXISTS (SELECT 1 FROM deletions d WHERE d.id = m.id)
            AND (m.search_content LIKE @like ESCAPE '\\'
              OR m.search_caption LIKE @like ESCAPE '\\'
              OR m.search_file_name LIKE @like ESCAPE '\\')
          ORDER BY m.timestamp DESC, m.conv_seq DESC, m.id ASC
          LIMIT @limit`).all(owner, { conv, like, limit });
        return rows.map(fromRow);
      });
    },
  };
}

export type SqliteStore = ReturnType<typeof createSqliteStore>;
