/**
 * IndexedDB v5 → v6 升级：给既有游标行回填「本机清空位点」（OFFLINE_BACKLOG_DESIGN §6.7）。
 *
 * 升级前清空过的会话没有任何痕迹，规则（与 Android MIGRATION_15_16、桌面 SQLite 迁移同一判据）：
 * 游标 > 0 的会话，位点 = 游标以内最小本地消息 seq − 1；游标以内本地一条没有则 = 游标。
 *
 * **这条没法放进 localStore.contract.ts**：契约只能经接口造数据，而「老库」是各实现自己的 schema 升级。
 * 所以这里真的先造一个 v5 库（含「旧版本标签页还开着、要在 versionchange 里让路」这一环——
 * SYMMETRY localStore 条：新增 store/升版曾导致「事务 NotFoundError → 列表空」），再让现行实现去升级它。
 * 不新增 store、不清缓存：只在升级事务里改游标行，既有消息一条不动。
 */
import { describe, it, expect } from "vitest";

const DB_NAME = "im-web";
const O = "o-bf";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

/** 造一个 v5 形状的库（四个 store，与 v5 的 STORE_DEFS 一致），并留着连接开着——模拟「旧版本标签页还没关」。 */
let oldTabYielded = false;
async function seedV5(): Promise<IDBDatabase> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 5);
    open.onupgradeneeded = () => {
      const d = open.result;
      const msgs = d.createObjectStore("messages", { keyPath: "id" });
      msgs.createIndex("ownerConv", "ownerConv", { unique: false });
      d.createObjectStore("sync_cursors", { keyPath: "id" });
      const del = d.createObjectStore("deletions", { keyPath: "id" });
      del.createIndex("ownerConv", "ownerConv", { unique: false });
      d.createObjectStore("conv_ranges", { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  // 旧版标签页自 v4 起就有这个处理：别的标签页要升级时让路。
  db.onversionchange = () => { oldTabYielded = true; db.close(); };

  const tx = db.transaction(["messages", "sync_cursors"], "readwrite");
  const cursor = (conv: string, convSeq: number, owner = O) =>
    tx.objectStore("sync_cursors").put({ id: `${owner}|${conv}`, owner, convId: conv, convSeq });
  const message = (conv: string, seq: number, owner = O) =>
    tx.objectStore("messages").put({ id: `${owner}|${conv}|${seq}`, ownerConv: `${owner}|${conv}`, owner, convId: conv, convSeq: seq, from: "u", content: "x", contentType: "text", timestamp: seq });

  cursor("a", 100); message("a", 41); message("a", 42); message("a", 100);   // 清到 40 为止（41 起还在）
  cursor("b", 50);                                                            // 游标以内一条没有：整段清掉
  cursor("c", 20); message("c", 1); message("c", 5);                          // 从 1 起就有：没清过
  cursor("e", 10); message("e", 3); message("e", 15);                         // 15 在游标之外（窗口岛），不参与；最小是 3
  message("f", 7);                                                            // 没有游标行：不回填
  cursor("a", 30, "o-other"); message("a", 25, "o-other");                    // 别的账号同名会话：各算各的
  message("a", 2, "o-other");
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  return db;
}

describe("v5 → v6 升级回填 clearedUpTo", () => {
  it("按规则回填；老连接让路后升级不被阻塞；既有消息一条不丢", async () => {
    const old = await seedV5();
    const store = await import("./localStore.web");   // 全新模块图：此刻才第一次 openDB(v6) → 触发升级

    expect(await store.webLocalStore.loadClearedUpTo(O, "a")).toBe(40);   // 最小本地 seq 41 → 40
    expect(await store.webLocalStore.loadClearedUpTo(O, "b")).toBe(50);   // 一条没有 → 游标
    expect(await store.webLocalStore.loadClearedUpTo(O, "c")).toBe(0);    // 最小是 1 → 0
    expect(await store.webLocalStore.loadClearedUpTo(O, "e")).toBe(2);    // 游标以外的 15 不算，最小是 3
    expect(await store.webLocalStore.loadClearedUpTo(O, "f")).toBe(0);    // 没有游标行
    expect(await store.webLocalStore.loadClearedUpTo("o-other", "a")).toBe(1);   // 别的账号：最小 2 → 1（25 在其后）

    // 升级没有清缓存：升级前的消息还在，且游标没变。
    expect((await store.webLocalStore.loadConversation(O, "a")).map((m) => m.convSeq)).toEqual([41, 42, 100]);
    expect(await store.webLocalStore.loadSyncCursor(O, "a")).toBe(100);
    expect(oldTabYielded).toBe(true);   // 升级确实经过了「老连接收到 versionchange 并让路」这一环
    void old;
  });

  it("回填出来的位点立刻生效：位点以内的补拉消息不落库，之后的照常", async () => {
    const { webLocalStore: s } = await import("./localStore.web");
    await s.saveMessage(O, { convId: "a", from: "u", content: "x", contentType: "text", convSeq: 40, timestamp: 1, status: "received" });
    await s.saveMessage(O, { convId: "a", from: "u", content: "x", contentType: "text", convSeq: 101, timestamp: 1, status: "received" });
    expect((await s.loadConversation(O, "a")).map((m) => m.convSeq)).toEqual([41, 42, 100, 101]);
  });

  it("只回填一次：之后推游标 / 再升级都不会改写已有位点", async () => {
    const { webLocalStore: s } = await import("./localStore.web");
    await s.advanceSyncCursor(O, "a", 200);
    expect(await s.loadClearedUpTo(O, "a")).toBe(40);
  });

  // 防止升级事务里的回填因事务提前结束而丢（IndexedDB 事务在没有待处理请求时自动提交）：
  // 上面第一条已经读到了 40/50/…，这条再确认读的是**落盘**的值而不是内存里算的。
  it("位点落在游标行里（读的是持久化的值）", async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const row = await req(db.transaction("sync_cursors").objectStore("sync_cursors").get(`${O}|b`));
    expect(row).toMatchObject({ convSeq: 50, clearedUpTo: 50 });
    db.close();
  });
});
