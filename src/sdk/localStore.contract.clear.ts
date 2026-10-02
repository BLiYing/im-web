// 「清空聊天记录」的**本机清空位点** `clearedUpTo` 契约断言（OFFLINE_BACKLOG_DESIGN §6.7）。
//
// 从 localStore.contract.ts 拆出（体量门禁）。同样是「任何 `LocalStore` 实现都必须满足」的一组：
// web(IndexedDB)、桌面代理、桌面 SQLite 三处共跑。**回填规则**（升级前清空过的老库）涉及各实现自己的
// schema 升级，没法经接口造「老库」，故由各实现的迁移测试守：
//   · web：`localStore.backfill.test.ts`（真的从 v5 升到 v6）；
//   · 桌面：`desktop/test/sqliteMigration.test.ts`（老 sync_cursors 表加列并回填）；
//   · 判据本身的纯函数：`clearFloor.test.ts`。

import { describe, expect, it } from "vitest";
import type { ContractCtx } from "./localStore.contract";

export function runClearFloorContract({ store, newOwner, msg }: ContractCtx): void {
  describe("本机清空位点 clearedUpTo（§6.7）", () => {
    // ---- 位点取值：max(knownLatest, 区间行 head, 同步游标, 本地最大 seq)，四个来源各钉一条 ----
    // 只喂一个来源、其余为空：任何一个来源被漏掉，对应那条就红（合在一起测会被别的来源掩护）。

    it("位点取本地最大消息 seq（只有它能证明的时候）", async () => {
      const o = newOwner("cf-local");
      await store.saveMessage(o, msg("c1", 7));
      await store.saveMessage(o, msg("c1", 3));
      await store.clearMessages(o, "c1");
      expect(await store.loadClearedUpTo(o, "c1")).toBe(7);
    });

    it("位点取同步游标", async () => {
      const o = newOwner("cf-cursor");
      await store.advanceSyncCursor(o, "c1", 9);
      await store.clearMessages(o, "c1");
      expect(await store.loadClearedUpTo(o, "c1")).toBe(9);
    });

    it("位点取区间行里记着的 head 快照（会话列表没给 latest 时）", async () => {
      const o = newOwner("cf-head");
      await store.updateRangesHead(o, "c1", 20);
      await store.clearMessages(o, "c1");
      expect(await store.loadClearedUpTo(o, "c1")).toBe(20);
    });

    it("位点取调用方给的 knownLatest（会话列表 latest / 内存 head）", async () => {
      const o = newOwner("cf-known");
      await store.saveMessage(o, msg("c1", 2));
      await store.clearMessages(o, "c1", 30);
      expect(await store.loadClearedUpTo(o, "c1")).toBe(30);
    });

    it("什么都不知道的空会话：位点是 0，不凭空编一个", async () => {
      const o = newOwner("cf-empty");
      await store.clearMessages(o, "c1");
      expect(await store.loadClearedUpTo(o, "c1")).toBe(0);
      expect(await store.loadClearedUpTo(o, "c-never")).toBe(0);
    });

    // ---- 只增不减 · 与游标/区间的关系 ----

    it("只增不减：再次清空给了更小的 knownLatest，位点不回退；更大则抬高", async () => {
      const o = newOwner("cf-mono");
      await store.clearMessages(o, "c1", 30);
      await store.clearMessages(o, "c1", 5);
      expect(await store.loadClearedUpTo(o, "c1")).toBe(30);
      await store.clearMessages(o, "c1", 44);
      expect(await store.loadClearedUpTo(o, "c1")).toBe(44);
    });

    it("清空把同步游标推到不小于位点", async () => {
      const o = newOwner("cf-cursor-push");
      await store.advanceSyncCursor(o, "c1", 3);
      await store.clearMessages(o, "c1", 30);
      expect(await store.loadSyncCursor(o, "c1")).toBe(30);
    });

    it("清空后区间清单是空的——**老库回退不许把 [1, cursor] 反推回来**", async () => {
      // 清空把游标推到了位点（>0）；若只是删掉区间行，loadRanges 会按「老库兼容」由游标反推出 [1,cursor]，
      // 等于宣称「这一段我已齐全」——而消息其实没了。必须落一行**空清单**。
      const o = newOwner("cf-ranges");
      await store.advanceSyncCursor(o, "c1", 7);
      expect((await store.loadRanges(o, "c1")).ranges).toEqual([{ lo: 1, hi: 7 }]);
      await store.clearMessages(o, "c1", 9);
      expect(await store.loadRanges(o, "c1")).toEqual({ ranges: [], head: 0 });
    });

    it("清空保留 head 快照（位点之后的「还差多少」要用它）", async () => {
      const o = newOwner("cf-keep-head");
      await store.registerRange(o, "c1", 1, 5, 40);
      await store.clearMessages(o, "c1");
      expect(await store.loadRanges(o, "c1")).toEqual({ ranges: [], head: 40 });
    });

    it("清空**不动墓碑**；位点以内的消息（含曾被单删的）重同步也回不来", async () => {
      const o = newOwner("cf-tomb");
      await store.saveMessage(o, msg("c1", 1));
      await store.saveMessage(o, msg("c1", 2));
      await store.markMessageDeleted(o, "c1", { convSeq: 1 });
      await store.clearMessages(o, "c1", 5);
      expect(await store.loadDeletedSeqs(o, "c1")).toEqual([1]);   // 墓碑还在
      await store.saveMessage(o, msg("c1", 1));
      await store.saveMessage(o, msg("c1", 2));
      expect(await store.loadConversation(o, "c1")).toEqual([]);
      await store.saveMessage(o, msg("c1", 6));                    // 位点之后的新消息照常收
      expect((await store.loadConversation(o, "c1")).map((m) => m.convSeq)).toEqual([6]);
    });

    it("位点按 owner、按会话隔离", async () => {
      const a = newOwner("cf-iso"), b = newOwner("cf-iso");
      await store.clearMessages(a, "c1", 30);
      expect(await store.loadClearedUpTo(a, "c2")).toBe(0);
      expect(await store.loadClearedUpTo(b, "c1")).toBe(0);
      await store.saveMessage(b, msg("c1", 5));                    // 别人的位点不挡我
      expect(await store.loadConversation(b, "c1")).toHaveLength(1);
    });

    // ---- 落库过滤：三条落库路径一条不漏 ----

    it("saveMessage：位点（含）以内丢弃，之后照常落", async () => {
      const o = newOwner("cf-save");
      await store.clearMessages(o, "c1", 10);
      await store.saveMessage(o, msg("c1", 9));
      await store.saveMessage(o, msg("c1", 10));
      expect(await store.loadConversation(o, "c1")).toEqual([]);
      await store.saveMessage(o, msg("c1", 11));
      expect((await store.loadConversation(o, "c1")).map((m) => m.convSeq)).toEqual([11]);
    });

    it("saveIncomingMessage（实时帧）：同上，且位点以内的不会借着「推游标」绕过", async () => {
      const o = newOwner("cf-incoming");
      await store.clearMessages(o, "c1", 10);
      await store.saveIncomingMessage(o, msg("c1", 8), true);
      expect(await store.loadConversation(o, "c1")).toEqual([]);
      expect(await store.loadSyncCursor(o, "c1")).toBe(10);        // 游标只增不减，没被 8 拉低
      await store.saveIncomingMessage(o, msg("c1", 11), true);
      expect((await store.loadConversation(o, "c1")).map((m) => m.convSeq)).toEqual([11]);
      expect(await store.loadSyncCursor(o, "c1")).toBe(11);
    });

    it("saveIncomingPage（sync / window 整页）：位点以内的丢，之后的留；游标与区间登记口径不变", async () => {
      const o = newOwner("cf-page");
      await store.clearMessages(o, "c1", 10);
      const ok = await store.saveIncomingPage(o, [msg("c1", 8), msg("c1", 9), msg("c1", 11), msg("c1", 12)], 12, 1, 12, 12);
      expect(ok).toBe(true);
      expect((await store.loadConversation(o, "c1")).map((m) => m.convSeq)).toEqual([11, 12]);
      expect(await store.loadSyncCursor(o, "c1")).toBe(12);
      expect(await store.loadRanges(o, "c1")).toEqual({ ranges: [{ lo: 1, hi: 12 }], head: 12 });
    });

    it("整页**都**在位点以内：什么消息都不落，但游标与区间照旧登记，返回成功", async () => {
      const o = newOwner("cf-page-all");
      await store.clearMessages(o, "c1", 10);
      expect(await store.saveIncomingPage(o, [msg("c1", 3), msg("c1", 4)], 4, 3, 4, 10)).toBe(true);
      expect(await store.loadConversation(o, "c1")).toEqual([]);
      expect((await store.loadRanges(o, "c1")).ranges).toEqual([{ lo: 3, hi: 4 }]);
    });

    it("被拒消息（convSeq=0）不受位点影响", async () => {
      const o = newOwner("cf-rej");
      await store.clearMessages(o, "c1", 10);
      await store.saveRejected(o, msg("c1", 0, { clientMsgId: "cm-1", status: "failed", note: "n" }));
      expect((await store.loadConversation(o, "c1")).map((m) => m.status)).toEqual(["failed"]);
    });

    // ---- 不被后续写入重置 ----

    it("游标 / 区间 / head / 操作推游标 / 整页写——这些后续写入既不重置也不降低位点（会话列表刷新同理）", async () => {
      // 会话列表快照整行重写曾是 Android 上清零位点的来路（applyConversationList 有测试钉着）。
      // Web 的位点与游标同行存放，**推游标那条路径把整行重写成 {id,owner,convId,convSeq}** 就会把它抹掉——最容易漏的一条。
      const o = newOwner("cf-keep");
      await store.clearMessages(o, "c1", 10);
      await store.advanceSyncCursor(o, "c1", 15);
      await store.advanceSyncCursor(o, "c1", 3);
      await store.registerRange(o, "c1", 11, 15, 15);
      await store.updateRangesHead(o, "c1", 99);
      await store.saveIncomingMessage(o, msg("c1", 16), true);
      await store.saveIncomingPage(o, [msg("c1", 17)], 17, 17, 17, 17);
      await store.saveMessage(o, msg("c1", 18));
      await store.applyMsgOpLocal(o, "c1", 18, { pinnedAt: 1 }, 20);
      expect(await store.loadClearedUpTo(o, "c1")).toBe(10);
      expect(await store.loadSyncCursor(o, "c1")).toBe(20);
    });
  });
}
