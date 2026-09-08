// 本地消息库的**契约断言集**（D4-3a，DESKTOP_DESIGN §7.6.4）。
//
// 这里是一组「任何 `LocalStore` 实现都必须满足」的断言，参数化在实现上：
//   · web（IndexedDB）在 localStore.contract.test.ts 里跑；
//   · D4-3b 的主进程 SQLite 实现照原样再跑一遍——**那正是本文件存在的唯一理由**。
//     它不在 `*.test.ts` 里，就是为了能被 `desktop/` 那个独立工程 import
//     （§7.4：im-web 的 `npm test` 不许依赖 Electron，反过来 desktop 要能复用这组断言）。
//
// 为什么是「同一组断言」而不是各测各的：这一层的价值全在「同一能力在两端语义一致」。
// 各测各的等于把两份实现当成两个独立模块，那正是 docs/SYMMETRY.md 在防的那种分叉。
//
// **写新断言的判据**：只放**跨实现**的语义（读回什么、隔离什么、什么不许发生）。
// IndexedDB 特有的东西（store 升级、陈旧连接降级）留在 localStore.test.ts，SQLite 那侧没有对应物。
//
// 用例之间靠**各用各的 owner** 互不干扰：实现是持久的、跨用例共享一个库，清库不在契约里。

import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./protocol";
import type { LocalStore } from "./localStore.types";

/** 跑一遍契约。传进来的实现应当是「可用状态」（已建库/已连上），本函数不负责初始化。 */
export function runLocalStoreContract(store: LocalStore): void {
  let seq = 0;
  /** 每个用例一个新 owner——实现是持久的，共用 owner 会串扰。不含 `|`（那是记录键的分隔符）。 */
  const newOwner = (tag: string) => `${store.name}.${tag}.${++seq}`;

  const msg = (convId: string, convSeq: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
    convId, from: "u-a", content: "x", contentType: "text",
    convSeq, timestamp: 1_700_000_000_000 + convSeq * 1000, status: "received", ...over,
  });

  describe(`LocalStore 契约 —— ${store.name}`, () => {
    // ---- 隔离 · 幂等 · 合并 ----

    it("按 owner 隔离：同一台机器上另一个账号读不到", async () => {
      const a = newOwner("iso"), b = newOwner("iso");
      await store.saveMessage(a, msg("c1", 1));
      expect(await store.loadConversation(b, "c1")).toEqual([]);
      expect(await store.searchMessages(b, { q: "x", limit: 20 })).toEqual([]);
    });

    it("同一 (owner, conv, conv_seq) 幂等覆盖，不产生第二条", async () => {
      const o = newOwner("idem");
      await store.saveMessage(o, msg("c1", 1, { content: "first" }));
      await store.saveMessage(o, msg("c1", 1, { content: "second" }));
      const got = await store.loadConversation(o, "c1");
      expect(got).toHaveLength(1);
      expect(got[0].content).toBe("second");
    });

    it("稀疏重放不得抹掉已存的文件名/字节数/昵称/角色/server_msg_id", async () => {
      // 同一条消息可能先由 ACK/实时帧落库、后由 sync_resp 再次到达，后到的那份字段更少。
      // 昵称那条是真实事故：超级群资料只下发本人，抹掉后整个会话的发件人变「未命名用户」。
      const o = newOwner("merge");
      await store.saveMessage(o, msg("c1", 1, {
        serverMsgId: "snow-1", fromNickname: "王铁柱", fromRole: "admin",
        contentType: "file", fileName: "photo.png", fileSize: 7340032,
      }));
      await store.saveMessage(o, msg("c1", 1, { contentType: "file", fileSize: 0 }));
      const got = (await store.loadConversation(o, "c1"))[0];
      expect(got.fileName).toBe("photo.png");
      expect(got.fileSize).toBe(7340032);
      expect(got.fromNickname).toBe("王铁柱");
      expect(got.fromRole).toBe("admin");
      expect(got.serverMsgId).toBe("snow-1");
    });

    // ---- 读回 ----

    it("按 conv_seq **数值**升序载回（与三端「消息显示序」同一条口径的底座）", async () => {
      // 序号故意跨到两位数：记录键是字符串（`owner|conv|seq`），字典序下 "10" < "2"。
      // 个位数的用例在这里是**没用的**——两个实现的天然存储序（IndexedDB 按主键、
      // SQLite 按 rowid/TEXT 列）都会碰巧给出正确答案，把排序删了照样绿。这条踩过。
      const o = newOwner("order");
      await store.saveMessage(o, msg("c1", 10));
      await store.saveMessage(o, msg("c1", 2));
      await store.saveMessage(o, msg("c1", 1));
      expect((await store.loadConversation(o, "c1")).map((m) => m.convSeq)).toEqual([1, 2, 10]);
    });

    it("字段整轮往返：落库→读回一个都不能少", async () => {
      // **这条是给 SQLite 实现的**。IndexedDB 存整个对象所以「不会漏」，换成逐列存储就会漏，
      // 而漏掉的表现全是「刷新后某样东西不见了」这种不像错误的样子：
      // 少 groupId → 相册散架；少 thumb → 门控图退化成斜纹底；少 mentionSpans → @ 不再高亮。
      const o = newOwner("roundtrip");
      const full: ChatMessage = msg("c1", 7, {
        from: "u-9", fromNickname: "王铁柱", fromRole: "admin",
        content: "看看这个 @小美", contentType: "image",
        fileName: "a.jpg", fileSize: 1234, caption: "会议室白板",
        mentions: ["u-3"], mentionSpans: [{ offset: 5, length: 3, uid: "u-3" }], mentionAll: true,
        serverMsgId: "snow-7",
        recalledAt: 11, recalledBy: "u-9", editedAt: 22, pinnedAt: 33,
        replyToConvSeq: 4, replySnapshot: "上一条", replyToFrom: "u-2", forwardFrom: "u-1",
        groupId: "g-1", posterUrl: "/uploads/p.jpg",
        mediaW: 800, mediaH: 600, duration: 3000, thumb: "data:image/jpeg;base64,AA",
      });
      await store.saveMessage(o, full);
      const got = (await store.loadConversation(o, "c1"))[0];
      const persisted: (keyof ChatMessage)[] = [
        "convId", "convSeq", "timestamp", "from", "fromNickname", "fromRole",
        "content", "contentType", "fileName", "fileSize", "caption",
        "mentions", "mentionSpans", "mentionAll", "serverMsgId",
        "recalledAt", "recalledBy", "editedAt", "pinnedAt",
        "replyToConvSeq", "replySnapshot", "replyToFrom", "forwardFrom",
        "groupId", "posterUrl", "mediaW", "mediaH", "duration", "thumb",
      ];
      for (const k of persisted) expect({ [k]: got[k] }).toEqual({ [k]: full[k] });
      expect(got.status).toBe("received");
    });

    it("系统消息分段落库：不然刷新后系统消息退回「显真实昵称、名字不可点」", async () => {
      const o = newOwner("sys");
      await store.saveMessage(o, msg("c1", 1, {
        contentType: "system", content: "张三 邀请 李四 加入群聊",
        sysSegments: [{ uid: "u-3", text: "张三" }, { text: " 邀请 " }, { uid: "u-4", text: "李四" }],
      }));
      expect((await store.loadConversation(o, "c1"))[0].sysSegments).toEqual([
        { uid: "u-3", text: "张三" }, { text: " 邀请 " }, { uid: "u-4", text: "李四" },
      ]);
    });

    it("conv_seq<=0（发送中/普通失败的临时态）不入库", async () => {
      const o = newOwner("nozero");
      await store.saveMessage(o, msg("c1", 0));
      await store.saveMessage(o, msg("c1", -1));
      expect(await store.loadConversation(o, "c1")).toEqual([]);
    });

    it("老记录没有 server_msg_id 时回退成复合键，不能读回空", async () => {
      const o = newOwner("sid");
      await store.saveMessage(o, msg("c1", 2));
      expect((await store.loadConversation(o, "c1"))[0].serverMsgId).toBe(`${o}|c1|2`);
    });

    // ---- 被拒消息（convSeq=0，服务端永不接受）----

    it("被拒消息按 client_msg_id 落库，还原 failed + 提示 + 媒体字段", async () => {
      const o = newOwner("rej");
      await store.saveRejected(o, msg("c1", 0, {
        clientMsgId: "cm-img", from: o, content: "/uploads/a.jpg", contentType: "image",
        status: "failed", note: "消息已发出，但被对方拒收了",
        fileName: "a.jpg", fileSize: 1234, groupId: "g-1", posterUrl: "/uploads/p.jpg",
        mediaW: 800, mediaH: 600, duration: 3000,
      }));
      const got = (await store.loadConversation(o, "c1"))[0];
      expect(got.status).toBe("failed");
      expect(got.convSeq).toBe(0);
      expect(got.clientMsgId).toBe("cm-img");
      expect(got.note).toBe("消息已发出，但被对方拒收了");
      // 被拒的媒体消息必须留住这些：少了就刷新后退化成显示 URL 的文本气泡、相册散架。
      expect(got.contentType).toBe("image");
      expect(got.groupId).toBe("g-1");
      expect(got.posterUrl).toBe("/uploads/p.jpg");
      expect([got.mediaW, got.mediaH, got.duration, got.fileName]).toEqual([800, 600, 3000, "a.jpg"]);
    });

    it("多条被拒各按各的 client_msg_id 共存，且与已确认消息同会话共存", async () => {
      const o = newOwner("rej2");
      const base = { from: o, status: "failed" as const, note: "n" };
      await store.saveRejected(o, msg("c1", 0, { ...base, clientMsgId: "a" }));
      await store.saveRejected(o, msg("c1", 0, { ...base, clientMsgId: "b" }));
      await store.saveMessage(o, msg("c1", 1));
      const got = await store.loadConversation(o, "c1");
      expect(got.filter((m) => m.status === "failed")).toHaveLength(2);
      expect(got.filter((m) => m.convSeq > 0)).toHaveLength(1);
    });

    // ---- 删除墓碑 ----

    it("删除留墓碑：重同步把它重新落库也不复现", async () => {
      const o = newOwner("tomb");
      await store.saveMessage(o, msg("c1", 1));
      await store.saveMessage(o, msg("c1", 2));
      await store.markMessageDeleted(o, "c1", { convSeq: 1 });
      expect((await store.loadConversation(o, "c1")).map((m) => m.convSeq)).toEqual([2]);
      await store.saveMessage(o, msg("c1", 1)); // 服务端重同步又推了一遍
      expect((await store.loadConversation(o, "c1")).map((m) => m.convSeq)).toEqual([2]);
      // 内存墓碑：实时帧那条路径绕过读盘过滤，靠它在收帧时拦截。
      expect(await store.loadDeletedSeqs(o, "c1")).toEqual([1]);
    });

    it("被拒消息按 client_msg_id 删除，且不混进 loadDeletedSeqs（服务端本就不会重推）", async () => {
      const o = newOwner("tomb2");
      await store.saveRejected(o, msg("c1", 0, { clientMsgId: "cm-1", status: "failed", note: "n" }));
      await store.saveMessage(o, msg("c1", 5));
      await store.markMessageDeleted(o, "c1", { clientMsgId: "cm-1" });
      expect((await store.loadConversation(o, "c1")).map((m) => m.convSeq)).toEqual([5]);
      expect(await store.loadDeletedSeqs(o, "c1")).toEqual([]);
    });

    it("墓碑按会话隔离：删了 c1 的第 1 条，不影响 c2 的第 1 条", async () => {
      const o = newOwner("tomb3");
      await store.saveMessage(o, msg("c1", 1));
      await store.saveMessage(o, msg("c2", 1));
      await store.markMessageDeleted(o, "c1", { convSeq: 1 });
      expect(await store.loadConversation(o, "c1")).toEqual([]);
      expect((await store.loadConversation(o, "c2")).map((m) => m.convSeq)).toEqual([1]);
    });

    // ---- 清空 ----

    it("清空聊天记录只清本会话本账号", async () => {
      const o = newOwner("clear"), other = newOwner("clear");
      await store.saveMessage(o, msg("c1", 1));
      await store.saveMessage(o, msg("c2", 1));
      await store.saveMessage(other, msg("c1", 1));
      await store.clearMessages(o, "c1");
      expect(await store.loadConversation(o, "c1")).toEqual([]);
      expect(await store.loadConversation(o, "c2")).toHaveLength(1);
      expect(await store.loadConversation(other, "c1")).toHaveLength(1);
    });

    // ---- 连续同步游标 ----

    it("无游标从 0 开始——**不许**用本地消息最大值推断", async () => {
      // 推断就会跳过中间没落库的段：本地有第 9 条不代表 1..8 都拿到了。
      const o = newOwner("cursor");
      await store.saveMessage(o, msg("c1", 9));
      expect(await store.loadSyncCursor(o, "c1")).toBe(0);
    });

    it("游标只单调推进，且按 owner 隔离", async () => {
      const a = newOwner("cursor2"), b = newOwner("cursor2");
      await store.advanceSyncCursor(a, "c1", 5);
      await store.advanceSyncCursor(a, "c1", 3); // 回退请求应被忽略
      expect(await store.loadSyncCursor(a, "c1")).toBe(5);
      expect(await store.loadSyncCursor(b, "c1")).toBe(0);
    });

    it("收单条：非连续的消息只落消息、绝不越级推游标", async () => {
      const o = newOwner("atomic");
      await store.saveIncomingMessage(o, msg("c1", 1), true);
      await store.saveIncomingMessage(o, msg("c1", 3), false);
      expect((await store.loadConversation(o, "c1")).map((m) => m.convSeq)).toEqual([1, 3]);
      expect(await store.loadSyncCursor(o, "c1")).toBe(1);
    });

    // ---- 整页写（桥上必须保留的原语）----

    it("整页写：一页消息 + 游标 + 区间一次落地，返回成功", async () => {
      const o = newOwner("page");
      const ok = await store.saveIncomingPage(o, [msg("c1", 1), msg("c1", 2), msg("c1", 3)], 3, 1, 3, 9);
      expect(ok).toBe(true);
      expect((await store.loadConversation(o, "c1")).map((m) => m.convSeq)).toEqual([1, 2, 3]);
      expect(await store.loadSyncCursor(o, "c1")).toBe(3);
      expect(await store.loadRanges(o, "c1")).toEqual({ ranges: [{ lo: 1, hi: 3 }], head: 9 });
    });

    it("整页写：advanceTo=0 不推游标，rangeTo<rangeFrom 不登记区间（调用方判定本页不可信）", async () => {
      const o = newOwner("page2");
      expect(await store.saveIncomingPage(o, [msg("c1", 4), msg("c1", 5)], 0, 4, 0)).toBe(true);
      expect((await store.loadConversation(o, "c1")).map((m) => m.convSeq)).toEqual([4, 5]);
      expect(await store.loadSyncCursor(o, "c1")).toBe(0);
      expect(await store.loadRanges(o, "c1")).toEqual({ ranges: [], head: 0 });
    });

    it("整页写：空页 / 整页都是无效 conv_seq 时返回成功且什么都不动", async () => {
      const o = newOwner("page3");
      expect(await store.saveIncomingPage(o, [], 5, 1, 5)).toBe(true);
      expect(await store.saveIncomingPage(o, [msg("c1", 0)], 5, 1, 5)).toBe(true);
      expect(await store.loadConversation(o, "c1")).toEqual([]);
      expect(await store.loadSyncCursor(o, "c1")).toBe(0);
    });

    // ---- 「本地有哪几段」目录 ----

    it("老库回退：只有游标、没有区间行时，反推出首段 [1, cursor]", async () => {
      // 不这么做的话老用户升级后会被判成「整个会话都是缺口」，本地搜索一夜之间集体改走服务端。
      const o = newOwner("ranges");
      await store.advanceSyncCursor(o, "c1", 7);
      expect(await store.loadRanges(o, "c1")).toEqual({ ranges: [{ lo: 1, hi: 7 }], head: 0 });
    });

    it("登记区间：相邻/重叠段合并，head 取 max（只涨不落）", async () => {
      const o = newOwner("ranges2");
      expect(await store.registerRange(o, "c1", 1, 3, 10)).toEqual([{ lo: 1, hi: 3 }]);
      expect(await store.registerRange(o, "c1", 4, 6, 5)).toEqual([{ lo: 1, hi: 6 }]); // 相邻合并
      expect(await store.registerRange(o, "c1", 20, 22)).toEqual([{ lo: 1, hi: 6 }, { lo: 20, hi: 22 }]);
      expect(await store.loadRanges(o, "c1")).toEqual({ ranges: [{ lo: 1, hi: 6 }, { lo: 20, hi: 22 }], head: 10 });
    });

    it("只更新 head 时**绝不动 ranges**——那正是「没下载就不许登记」", async () => {
      // too_long / conv_bump：知道了服务端最新位点，但一条正文都没拿到。
      const o = newOwner("ranges3");
      await store.registerRange(o, "c1", 1, 5, 5);
      await store.updateRangesHead(o, "c1", 100);
      expect(await store.loadRanges(o, "c1")).toEqual({ ranges: [{ lo: 1, hi: 5 }], head: 100 });
      await store.updateRangesHead(o, "c1", 50); // 回退的 head 忽略
      expect((await store.loadRanges(o, "c1")).head).toBe(100);
    });

    it("空会话读区间：返回空清单而不是抛", async () => {
      expect(await store.loadRanges(newOwner("ranges4"), "c-none")).toEqual({ ranges: [], head: 0 });
    });

    // ---- 消息操作（撤回 / 编辑 / 置顶）----

    it("撤回 / 编辑 / 置顶就地更新已落库消息", async () => {
      const o = newOwner("op");
      await store.saveMessage(o, msg("c1", 1, { content: "old" }));
      await store.applyMsgOpLocal(o, "c1", 1, { recalledAt: 9999, recalledBy: "u-a" });
      expect((await store.loadConversation(o, "c1"))[0]).toMatchObject({ recalledAt: 9999, recalledBy: "u-a" });
      await store.applyMsgOpLocal(o, "c1", 1, { editedAt: 8888, content: "new" });
      expect((await store.loadConversation(o, "c1"))[0]).toMatchObject({ content: "new", editedAt: 8888 });
      await store.applyMsgOpLocal(o, "c1", 1, { pinnedAt: 7777 });
      expect((await store.loadConversation(o, "c1"))[0].pinnedAt).toBe(7777);
    });

    it("编辑正文必须连带清空 mentionSpans（否则点 @ 会进另一个人的资料页）", async () => {
      // 偏移是相对原文的，正文一改就全错位；只要新正文碰巧在同一偏移有个 `@`，就会高亮出来。
      const o = newOwner("op2");
      await store.saveMessage(o, msg("c1", 1, {
        content: "叫上 @小美 一起", mentions: ["u-3"], mentionSpans: [{ offset: 3, length: 3, uid: "u-3" }],
      }));
      await store.applyMsgOpLocal(o, "c1", 1, { editedAt: 1, content: "叫上 @小明 一起" });
      expect((await store.loadConversation(o, "c1"))[0].mentionSpans).toBeUndefined();
    });

    it("操作目标不存在时忽略——**不许**凭空新建一行", async () => {
      const o = newOwner("op3");
      await store.applyMsgOpLocal(o, "c1", 7, { recalledAt: 1 });
      expect(await store.loadConversation(o, "c1")).toEqual([]);
    });

    it("操作可顺带推进游标（同一次调用里完成）", async () => {
      const o = newOwner("op4");
      await store.saveMessage(o, msg("c1", 1));
      await store.applyMsgOpLocal(o, "c1", 1, { pinnedAt: 1 }, 4);
      expect(await store.loadSyncCursor(o, "c1")).toBe(4);
    });

    // ---- 搜索（命中判据是跨端契约）----

    it("会话内：text 正文命中，大小写不敏感，结果新→旧", async () => {
      const o = newOwner("search");
      await store.saveMessage(o, msg("c1", 1, { content: "Q3 预算终稿" }));
      await store.saveMessage(o, msg("c1", 2, { content: "无关内容" }));
      await store.saveMessage(o, msg("c1", 3, { content: "预算表改好了" }));
      expect((await store.searchMessages(o, { convId: "c1", q: "预算", limit: 20 })).map((r) => r.convSeq))
        .toEqual([3, 1]);
      await store.saveMessage(o, msg("c1", 4, { content: "Hello Budget World" }));
      expect(await store.searchMessages(o, { convId: "c1", q: "BUDGET", limit: 20 })).toHaveLength(1);
    });

    it("**两个字的中文必须搜得到**（这条是「不上 FTS5」那个决定的守门人）", async () => {
      // DESKTOP_DESIGN §7.6.1：FTS5 的 trigram 分词器要 ≥3 字符，「开会」「排期」一律不命中，
      // 而且是**静默失效**（搜不到 ≠ 报错）。中文搜索绝大多数就是两个字。
      // 这条红了 = 有人把判据换成了分词匹配，回去读 §7.6.1，别改测试。
      const o = newOwner("search-cjk");
      await store.saveMessage(o, msg("c1", 1, { content: "明天下午三点开会" }));
      expect(await store.searchMessages(o, { convId: "c1", q: "开会", limit: 20 })).toHaveLength(1);
      expect(await store.searchMessages(o, { convId: "c1", q: "点", limit: 20 })).toHaveLength(1);
      expect(await store.searchMessages(o, { convId: "c1", q: "下午三点", limit: 20 })).toHaveLength(1);
    });

    it("带标点的文件名照样能搜（FTS5 在这儿会直接报语法错）", async () => {
      const o = newOwner("search-punct");
      await store.saveMessage(o, msg("c1", 1, {
        content: "/uploads/deadbeef.bin", contentType: "file", fileName: "Q3.xlsx",
      }));
      expect(await store.searchMessages(o, { convId: "c1", q: "Q3.xlsx", limit: 20 })).toHaveLength(1);
    });

    it("caption 与 fileName 命中；媒体/文件的 content（URL）**不**参与命中", async () => {
      // 参与的话，搜索词撞上服务端生成的 URL 片段会命中「看不见文字」的消息。
      const o = newOwner("search2");
      await store.saveMessage(o, msg("c1", 1, {
        content: "/uploads/x.jpg", contentType: "image", caption: "会议室白板预算照片",
      }));
      await store.saveMessage(o, msg("c1", 2, {
        content: "/uploads/deadbeef111.pdf", contentType: "file", fileName: "Q3-预算-终稿.xlsx",
      }));
      expect((await store.searchMessages(o, { convId: "c1", q: "预算", limit: 20 })).map((r) => r.convSeq))
        .toEqual([2, 1]);
      expect(await store.searchMessages(o, { convId: "c1", q: "deadbeef", limit: 20 })).toEqual([]);
      expect(await store.searchMessages(o, { convId: "c1", q: "111", limit: 20 })).toEqual([]);
    });

    it("撤回的消息不参与命中", async () => {
      const o = newOwner("search3");
      await store.saveMessage(o, msg("c1", 1, { content: "预算机密" }));
      await store.applyMsgOpLocal(o, "c1", 1, { recalledAt: 9999, recalledBy: "u-a" });
      expect(await store.searchMessages(o, { convId: "c1", q: "预算", limit: 20 })).toEqual([]);
    });

    it("本地删除（墓碑）的消息不参与命中", async () => {
      const o = newOwner("search4");
      await store.saveMessage(o, msg("c1", 1, { content: "预算A" }));
      await store.saveMessage(o, msg("c1", 2, { content: "预算B" }));
      await store.markMessageDeleted(o, "c1", { convSeq: 1 });
      expect((await store.searchMessages(o, { convId: "c1", q: "预算", limit: 20 })).map((r) => r.convSeq))
        .toEqual([2]);
    });

    it("limit 截断保留**最新**的那几条", async () => {
      const o = newOwner("search5");
      for (let i = 1; i <= 5; i++) await store.saveMessage(o, msg("c1", i, { content: `预算${i}` }));
      expect((await store.searchMessages(o, { convId: "c1", q: "预算", limit: 2 })).map((r) => r.convSeq))
        .toEqual([5, 4]);
    });

    it("全局搜索跨会话命中，并且仍按 owner 隔离", async () => {
      const o = newOwner("search6"), other = newOwner("search6");
      await store.saveMessage(o, msg("c1", 1, { content: "预算在 c1" }));
      await store.saveMessage(o, msg("c2", 1, { content: "预算在 c2" }));
      await store.saveMessage(o, msg("c2", 2, { content: "无关" }));
      await store.saveMessage(other, msg("c1", 1, { content: "别人的预算" }));
      const hits = await store.searchMessages(o, { q: "预算", limit: 20 });
      expect(hits).toHaveLength(2);
      expect(new Set(hits.map((r) => r.convId))).toEqual(new Set(["c1", "c2"]));
    });

    it("空查询 / 纯空白 / limit<=0 一律返回空，不做全表扫", async () => {
      const o = newOwner("search7");
      await store.saveMessage(o, msg("c1", 1, { content: "预算" }));
      expect(await store.searchMessages(o, { convId: "c1", q: "  ", limit: 20 })).toEqual([]);
      expect(await store.searchMessages(o, { convId: "c1", q: "", limit: 20 })).toEqual([]);
      expect(await store.searchMessages(o, { convId: "c1", q: "预算", limit: 0 })).toEqual([]);
    });

    // ---- 失败只降级，绝不抛 ----

    it("空 owner / 空 convId 一律安全返回，绝不抛（持久化是增强，不许阻断收发主流程）", async () => {
      await expect(store.saveMessage("", msg("c1", 1))).resolves.toBeUndefined();
      await expect(store.saveIncomingMessage("", msg("c1", 1), true)).resolves.toBeUndefined();
      await expect(store.saveRejected("", msg("c1", 0, { clientMsgId: "x" }))).resolves.toBeUndefined();
      await expect(store.applyMsgOpLocal("", "c1", 1, { pinnedAt: 1 })).resolves.toBeUndefined();
      await expect(store.markMessageDeleted("", "c1", { convSeq: 1 })).resolves.toBeUndefined();
      await expect(store.clearMessages("", "c1")).resolves.toBeUndefined();
      await expect(store.advanceSyncCursor("", "c1", 1)).resolves.toBeUndefined();
      await expect(store.updateRangesHead("", "c1", 1)).resolves.toBeUndefined();
      await expect(store.registerRange("", "c1", 1, 2)).resolves.toEqual([]);
      await expect(store.saveIncomingPage("", [msg("c1", 1)], 1, 1, 1)).resolves.toBe(true);
      await expect(store.loadConversation("", "c1")).resolves.toEqual([]);
      await expect(store.loadConversation("o", "")).resolves.toEqual([]);
      await expect(store.loadDeletedSeqs("", "c1")).resolves.toEqual([]);
      await expect(store.loadSyncCursor("", "c1")).resolves.toBe(0);
      await expect(store.loadRanges("", "c1")).resolves.toEqual({ ranges: [], head: 0 });
      await expect(store.searchMessages("", { q: "x", limit: 5 })).resolves.toEqual([]);
    });
  });
}
