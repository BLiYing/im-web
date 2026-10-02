// 老库加列的迁移。**这条守的是「加一个字段 → 所有既有安装静默丢掉本地历史」**。
//
// 失效路径很短也很安静：`CREATE TABLE IF NOT EXISTS` 对已存在的表什么都不做 →
// INSERT 的列名从 MESSAGE_COLUMNS 派生 → 老库少一列 → `db.prepare` 抛
// `table messages has no column named X` → 异常冒出 `createSqliteStore` →
// 主进程把 store 置 null → 页面回落到一个**空的** IndexedDB。
// 用户看到「聊天记录全没了」，日志里只有一行 stderr。
import { afterEach, describe, expect, it } from "vitest";
import DatabaseCtor from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteStore } from "../src/main/sqliteStore";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** 造一个「上一版」的库：列只有当年那些（少了 waveform 与三个检索列里的一个），并塞一条真实消息。 */
function legacyDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "im-store-"));
  dirs.push(dir);
  const file = join(dir, "messages.db");
  const db = new DatabaseCtor(file);
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, conv_id TEXT NOT NULL, conv_seq INTEGER NOT NULL,
      from_uid TEXT NOT NULL, from_nickname TEXT, from_role TEXT,
      content TEXT NOT NULL, content_type TEXT NOT NULL,
      file_name TEXT, file_size INTEGER, caption TEXT,
      mentions TEXT, mention_spans TEXT, mention_all INTEGER, sys_segments TEXT,
      timestamp INTEGER NOT NULL, server_msg_id TEXT, client_msg_id TEXT, status TEXT, note TEXT,
      recalled_at INTEGER, recalled_by TEXT, edited_at INTEGER, pinned_at INTEGER,
      reply_to_conv_seq INTEGER, reply_snapshot TEXT, reply_to_from TEXT, forward_from TEXT,
      group_id TEXT, poster_url TEXT, media_w INTEGER, media_h INTEGER, duration INTEGER, thumb TEXT,
      search_content TEXT NOT NULL DEFAULT '', search_caption TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare(`INSERT INTO messages (id, owner, conv_id, conv_seq, from_uid, content, content_type, timestamp, search_content)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("o1|c1|1", "o1", "c1", 1, "u-a", "老库里的一条消息", "text", 1000, "老库里的一条消息");
  db.close();
  return file;
}

describe("老库加列迁移", () => {
  it("打开老库不抛，且**原有数据仍在**", async () => {
    const store = createSqliteStore(legacyDb(), () => {});
    const got = await store.loadConversation("o1", "c1");
    expect(got).toHaveLength(1);
    expect(got[0].content).toBe("老库里的一条消息");
    store.close();
  });

  it("新列补齐后可读可写：waveform 能往返，新检索列能命中", async () => {
    const store = createSqliteStore(legacyDb(), () => {});
    await store.saveMessage("o1", {
      convId: "c1", from: "u-a", content: "/uploads/v.m4a", contentType: "voice",
      convSeq: 2, timestamp: 2000, fileName: "语音备忘.m4a", waveform: "ChwsPU1e",
    });
    const got = await store.loadConversation("o1", "c1");
    expect(got.map((m) => m.convSeq)).toEqual([1, 2]);
    expect(got[1].waveform).toBe("ChwsPU1e");
    // search_file_name 是这次补的列——命中说明它不只是被 ADD 了，还真的在参与判据
    expect((await store.searchMessages("o1", { convId: "c1", q: "备忘", limit: 20 })).map((r) => r.convSeq))
      .toEqual([2]);
    store.close();
  });

  it("老库里既有的行**不会**因为补列而丢字段（补的列是空值，不是整行重建）", async () => {
    const store = createSqliteStore(legacyDb(), () => {});
    const got = (await store.loadConversation("o1", "c1"))[0];
    expect(got.waveform).toBeUndefined();   // 老行本来就没有，读回是 undefined 不是 null
    expect(got.content).toBe("老库里的一条消息");
    store.close();
  });
});

// ---- 本机清空位点 sync_cursors.cleared_up_to（OFFLINE_BACKLOG_DESIGN §6.7）----
//
// 回填规则（与 im-web localStore.backfill.test.ts、Android MIGRATION_15_16 同一判据）：游标>0 的会话，
// 位点 = 游标以内最小本地消息 seq − 1；游标以内本地一条没有则 = 游标。**不清缓存**：只加列 + 一条 UPDATE。
// 契约（localStore.contract.clear.ts）经接口造不出「老库」，所以这条由本文件守。

/** 造一个「没有 cleared_up_to 列」的上一版库：sync_cursors 只有四列，并塞好各种形状的会话。 */
function legacyCursorDb(): string {
  const file = legacyDb();            // 复用上面的老 messages 表（带 o1|c1|1 一条）
  const db = new DatabaseCtor(file);
  db.exec(`
    CREATE TABLE sync_cursors (id TEXT PRIMARY KEY, owner TEXT NOT NULL, conv_id TEXT NOT NULL, conv_seq INTEGER NOT NULL);
    CREATE TABLE conv_ranges (id TEXT PRIMARY KEY, owner TEXT NOT NULL, conv_id TEXT NOT NULL, ranges TEXT NOT NULL, head INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE deletions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, conv_id TEXT NOT NULL);
  `);
  const cur = db.prepare("INSERT INTO sync_cursors (id, owner, conv_id, conv_seq) VALUES (?, ?, ?, ?)");
  const msg = db.prepare(`INSERT INTO messages (id, owner, conv_id, conv_seq, from_uid, content, content_type, timestamp)
                          VALUES (?, ?, ?, ?, 'u', 'x', 'text', 1)`);
  const put = (owner: string, conv: string, seq: number) => msg.run(`${owner}|${conv}|${seq}`, owner, conv, seq);
  cur.run("o1|a", "o1", "a", 100); put("o1", "a", 41); put("o1", "a", 42); put("o1", "a", 100);   // 清到 40
  cur.run("o1|b", "o1", "b", 50);                                                                    // 一条没有 → 游标
  cur.run("o1|c", "o1", "c", 20); put("o1", "c", 1); put("o1", "c", 5);                              // 从 1 起 → 0
  cur.run("o1|e", "o1", "e", 10); put("o1", "e", 3); put("o1", "e", 15);                             // 15 在游标外
  put("o1", "f", 7);                                                                                 // 没有游标行
  cur.run("o2|a", "o2", "a", 30); put("o2", "a", 25); put("o2", "a", 2);                             // 别的账号同名会话
  db.close();
  return file;
}

describe("老库加 cleared_up_to 列并回填", () => {
  it("按规则回填；既有消息一条不丢（不清缓存）", async () => {
    const store = createSqliteStore(legacyCursorDb(), () => {});
    expect(await store.loadClearedUpTo("o1", "a")).toBe(40);
    expect(await store.loadClearedUpTo("o1", "b")).toBe(50);
    expect(await store.loadClearedUpTo("o1", "c")).toBe(0);
    expect(await store.loadClearedUpTo("o1", "e")).toBe(2);
    expect(await store.loadClearedUpTo("o1", "f")).toBe(0);
    expect(await store.loadClearedUpTo("o2", "a")).toBe(1);
    expect((await store.loadConversation("o1", "a")).map((m) => m.convSeq)).toEqual([41, 42, 100]);
    expect(await store.loadSyncCursor("o1", "a")).toBe(100);
    store.close();
  });

  it("只回填一次：重开库、再推游标都不会改写已有位点", async () => {
    const file = legacyCursorDb();
    createSqliteStore(file, () => {}).close();
    const again = createSqliteStore(file, () => {});
    await again.advanceSyncCursor("o1", "a", 200);
    expect(await again.loadClearedUpTo("o1", "a")).toBe(40);
    again.close();
  });

  it("回填出来的位点立刻生效：位点以内的补拉消息不落库，之后的照常", async () => {
    const store = createSqliteStore(legacyCursorDb(), () => {});
    const m = (convSeq: number) => ({ convId: "a", from: "u", content: "x", contentType: "text", convSeq, timestamp: 1 });
    await store.saveMessage("o1", m(40));
    await store.saveMessage("o1", m(101));
    expect((await store.loadConversation("o1", "a")).map((r) => r.convSeq)).toEqual([41, 42, 100, 101]);
    store.close();
  });
});
