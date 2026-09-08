// 契约里**搜索那一族**的断言（从 localStore.contract.ts 拆出，CODING_STYLE §7 体量门禁）。
//
// 单独成文件不只是为了行数：搜索是这套契约里**跨实现差异最大**的一块——web 读时现算命中，
// SQLite 把命中所需的文本冻进检索列，于是它独有一批别处不会出现的失效
// （SQL 的 lower() 只折叠 ASCII、LIKE 的元字符、打平时没有最终键、空串 convId、非整数 limit）。
// 放一起看得清楚。
//
// 由 localStore.contract.ts 在同一个 describe 里调用，共用它的 owner 与消息工厂。
import { expect, it } from "vitest";
import type { ContractCtx } from "./localStore.contract";

export function runSearchContract(ctx: ContractCtx): void {
  const { store, newOwner, msg } = ctx;

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

  it("大小写不敏感必须覆盖**非 ASCII**（SQL 的 lower() 只认 A-Z，会静默漏）", async () => {
    // 这条是给 SQLite 实现的。若查询时写成 `WHERE lower(content) LIKE lower(?)`，
    // SQLite 内建的 lower() **只折叠 ASCII**：`lower('Äpfel')` 原样返回，
    // 于是「ÄPFEL」搜不到「äpfel」，而且**不报错**——与 FTS5 那个坑同一种静默失效。
    // 正确做法是落库时用 JS 的 toLowerCase() 算好检索列，判据就与 web 侧逐字相同。
    const o = newOwner("search-fold");
    await store.saveMessage(o, msg("c1", 1, { content: "Äpfel und Öl" }));
    expect(await store.searchMessages(o, { convId: "c1", q: "ÄPFEL", limit: 20 })).toHaveLength(1);
    expect(await store.searchMessages(o, { convId: "c1", q: "äpfel", limit: 20 })).toHaveLength(1);
    expect(await store.searchMessages(o, { convId: "c1", q: "öl", limit: 20 })).toHaveLength(1);
  });

  it("查询词里的 `%` 与 `_` 是**字面量**，不是通配符", async () => {
    // 同样是给 SQLite 实现的：`LIKE` 的元字符不转义，搜「50%」会变成「50 后面随便什么」，
    // 搜「a_b」会命中「axb」。web 侧的 `includes` 天然是字面量，所以这个洞只在关系实现里出现。
    const o = newOwner("search-like");
    await store.saveMessage(o, msg("c1", 1, { content: "折扣 50%" }));
    await store.saveMessage(o, msg("c1", 2, { content: "折扣 50 元起" }));
    await store.saveMessage(o, msg("c1", 3, { content: "变量 a_b" }));
    await store.saveMessage(o, msg("c1", 4, { content: "变量 axb" }));
    expect((await store.searchMessages(o, { convId: "c1", q: "50%", limit: 20 })).map((r) => r.convSeq))
      .toEqual([1]);
    expect((await store.searchMessages(o, { convId: "c1", q: "a_b", limit: 20 })).map((r) => r.convSeq))
      .toEqual([3]);
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

  it("本地删除（墓碑）的消息不参与命中——**包括被重同步落回来之后**", async () => {
    // 删完直接查是**测不出墓碑的**：查不到只是因为消息行本来就被删了。
    // 墓碑唯一起作用的场景就是"删完之后服务端又推了一遍"，所以这里必须补那一步——
    // 少了它，实现里漏掉搜索侧的墓碑过滤照样全绿，然后用户删掉的消息会在首页
    // 「聊天记录」栏重新冒出来（点进去还跳到一条聊天页里根本不显示的消息）。
    const o = newOwner("search4");
    await store.saveMessage(o, msg("c1", 1, { content: "预算A" }));
    await store.saveMessage(o, msg("c1", 2, { content: "预算B" }));
    await store.markMessageDeleted(o, "c1", { convSeq: 1 });
    await store.saveMessage(o, msg("c1", 1, { content: "预算A" })); // 服务端重同步又落了一遍
    expect((await store.searchMessages(o, { convId: "c1", q: "预算", limit: 20 })).map((r) => r.convSeq))
      .toEqual([2]);
  });

  it("timestamp 与 conv_seq 都打平时，顺序仍是**确定**的（否则 limit 会截出不同的消息）", async () => {
    // 不是"排序好看"的问题：没有唯一的最终键时，两套实现在打平的行上给出不同顺序，
    // 加上 limit 就会**截出不同的几条消息**——同一个搜索词在两端返回不同结果集。
    // SYMMETRY 那条「搜索命中判据一致」守的正是这个。打平在真实数据里够得着：
    // 被拒消息 convSeq 恒为 0，同一批落库的时间戳也可能一样。
    const o = newOwner("search-tie");
    // **插入序刻意与记录键序相反**：按 c1/c2/c3 插的话，SQLite 的天然扫描序（rowid）
    // 恰好等于记录键序，没有最终键也照样"对"，这条断言就不算数了（头一版就是这么写的）。
    for (const c of ["c3", "c1", "c2"]) {
      await store.saveRejected(o, msg(c, 0, {
        clientMsgId: `cm-${c}`, from: o, content: "打平的命中词", status: "failed", note: "n", timestamp: 5000,
      }));
    }
    const all = await store.searchMessages(o, { q: "打平", limit: 20 });
    expect(all).toHaveLength(3);
    const twice = await store.searchMessages(o, { q: "打平", limit: 20 });
    expect(twice.map((r) => r.id)).toEqual(all.map((r) => r.id));       // 同一实现内稳定
    const top2 = await store.searchMessages(o, { q: "打平", limit: 2 });
    expect(top2.map((r) => r.id)).toEqual(all.slice(0, 2).map((r) => r.id)); // limit 截的是前缀
    // 跨实现一致：打平时按记录键升序（web 的稳定排序落在 IndexedDB 主键序上，就是这个）
    expect(all.map((r) => r.convId)).toEqual(["c1", "c2", "c3"]);
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

  it("convId 空串按**全局**算，limit 非整数不得静默变成零结果", async () => {
    // 两条都是 JS 侧隐式做掉、关系实现不会自动做的归一化：
    // `if (opts.convId)` 把空串当"没给"，而 `m.conv_id = ''` 谁也匹配不上；
    // `LIMIT 2.5` 在 SQLite 里直接回零行——又是"搜不到但不报错"。
    const o = newOwner("search-norm");
    await store.saveMessage(o, msg("c1", 1, { content: "归一化" }));
    await store.saveMessage(o, msg("c2", 1, { content: "归一化" }));
    expect(await store.searchMessages(o, { convId: "", q: "归一化", limit: 20 })).toHaveLength(2);
    expect(await store.searchMessages(o, { q: "归一化", limit: 2.5 })).toHaveLength(2);
  });

  it("空查询 / 纯空白 / limit<=0 一律返回空，不做全表扫", async () => {
    const o = newOwner("search7");
    await store.saveMessage(o, msg("c1", 1, { content: "预算" }));
    expect(await store.searchMessages(o, { convId: "c1", q: "  ", limit: 20 })).toEqual([]);
    expect(await store.searchMessages(o, { convId: "c1", q: "", limit: 20 })).toEqual([]);
    expect(await store.searchMessages(o, { convId: "c1", q: "预算", limit: 0 })).toEqual([]);
  });
}
