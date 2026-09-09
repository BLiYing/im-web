#!/usr/bin/env python3
"""变异验证：把实现逐条改坏，确认契约测试**真的会红**。

    ./scripts/mutation-check.py            # 两套都跑
    ./scripts/mutation-check.py web        # 只跑 web（IndexedDB）
    ./scripts/mutation-check.py sqlite     # 只跑桌面端主进程 SQLite

为什么要有它（CODING_STYLE.md §九「测试有效性」的自动化版）：**没红过的测试不算数**。
断言写错对象、根本没跑到那个分支，照样全绿。2026-09-08~09 这两天，本脚本抓出了四条
「读起来像在守某件事、其实在被测实现上根本红不了」的断言：

  · 「按 conv_seq 升序」用个位数序号——记录键是字符串，字典序恰好等于数字序，删掉 sort 照样绿
  · e2e 查「SQLite 总行数 > 0」——库是持久的，上一轮遗留的数据让它恒真，把桥打断也照样绿
  · 「打平时顺序确定」按 c1/c2/c3 插入——SQLite 的 rowid 序恰好等于记录键序
  · 「中途断线不留残缺文件」——直接写目标、失败后在 catch 里删掉，它照样过

判据是**「这条断言在被测实现上真的会红吗」**，不是「它读起来像在守什么」。

**加断言时请顺手加一条变异**：没有对应变异的断言，等于回到了「靠读」的状态。

注意：本脚本会**反复改写源码再还原**（写回原文快照，不是反向替换——反向替换踩过一次，
把整个文件替烂了）。跑之前请确认工作区干净，跑完它会自己还原；中途 Ctrl+C 可能留下改动，
用 `git diff` 检查。
"""
from __future__ import annotations

import logging
import pathlib
import subprocess
import sys
from dataclasses import dataclass, field

REPO = pathlib.Path(__file__).resolve().parents[1]      # im-web/
DESKTOP = REPO / "desktop"

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("mutation")


@dataclass(frozen=True)
class Mutation:
    """一个变异体 + 期望被它打红的用例关键词。

    `extra` 用于**多层防御**的不变量：有的判据被守了两三遍（例如「倒过来的区间不许登记」=
    store 守卫 + addRange + normalizeRanges 三层），只打其中一层另两层会接住、断言不会红——
    那不代表断言没在守，只代表这一层是冗余的。要证明断言是承重的，就得把每一处强制点同时拆掉。
    """

    name: str
    file: str
    old: str
    new: str
    expect_hit: str
    extra: tuple[tuple[str, str, str], ...] = field(default=())

    def edits(self) -> list[tuple[str, str, str]]:
        return [(self.file, self.old, self.new), *self.extra]


@dataclass(frozen=True)
class Suite:
    """一套变异：在哪个工程、跑哪个测试文件、有哪些变异体。"""

    name: str
    cwd: pathlib.Path
    test_file: str
    mutations: list[Mutation]


# ---- 桌面端 SQLite 实现的两个文件（下面变异里反复引用） ----
ROWS = "src/main/sqliteRows.ts"
STORE = "src/main/sqliteStore.ts"

WEB_MUTATIONS: list[Mutation] = [

    Mutation(
        "搜索改成 FTS5 那样的 ≥3 字符分词匹配",
        "src/sdk/localStore.web.search.ts",
        "function matchesQuery(rec: MsgRecord, needle: string): boolean {",
        "function matchesQuery(rec: MsgRecord, needle: string): boolean {\n  if (needle.length < 3) return false;",
        "两个字的中文",
    ),
    Mutation(
        "读回不再按 conv_seq 升序",
        "src/sdk/localStore.web.ts",
        "recs.sort((a, b) => a.convSeq - b.convSeq);",
        "/*MUT*/",
        "升序载回",
    ),
    Mutation(
        "稀疏重放抹掉已存昵称",
        "src/sdk/localStore.types.ts",
        "fromNickname: rec.fromNickname || existing?.fromNickname,",
        "fromNickname: rec.fromNickname,",
        "稀疏重放",
    ),
    Mutation(
        "落库漏掉 thumb 字段（SQLite 少建一列的等价物）",
        "src/sdk/localStore.web.ts",
        "duration: m.duration, thumb: m.thumb, waveform: m.waveform,",
        "duration: m.duration, waveform: m.waveform,",
        "字段整轮往返",
    ),
    Mutation(
        "编辑正文后不清 mentionSpans",
        "src/sdk/localStore.web.ts",
        "            rec.mentionSpans = undefined;",
        "/*MUT*/",
        "mentionSpans",
    ),
    Mutation(
        "updateRangesHead 顺手把 ranges 也覆盖了",
        "src/sdk/localStore.web.ranges.ts",
        "          ranges: normalizeRanges(prev?.ranges ?? []),",
        "          ranges: [],",
        "绝不动 ranges",
    ),
    Mutation(
        "游标改成从本地消息最大值推断",
        "src/sdk/localStore.web.db.ts",
        "  if (!owner || !convId) return 0;",
        "  if (!owner || !convId) return 0;\n  if (convId) return 9;",
        "无游标从 0 开始",
    ),
    Mutation(
        "墓碑不再拦住重同步落库的消息",
        "src/sdk/localStore.web.ts",
        "    return recs.filter((r) => !deleted.has(r.id)).map((r) =>",
        "    return recs.map((r) =>",
        "重同步",
    ),
    # ---- 以下 8 条来自 /code-review 的复查：每条都对应一个「用例名声称在守、其实没在守」的洞 ----
    Mutation(
        "搜索侧不再过滤墓碑（删完又被重同步落回来的会复现）",
        "src/sdk/localStore.web.search.ts",
        "          .filter((r) => !deleted.has(r.id))\n",
        "",
        "被重同步落回来之后",
    ),
    Mutation(
        # web 侧那句 `rec.owner === owner` 是**冗余**的（索引键 ownerConv 里已经含 owner），
        # 删它杀不掉任何断言。真正的强制点是索引查询本身，所以这里打的是它——
        # 换成「扫全表 + 只按 conv 过滤」，正是 SQLite 侧写成 `WHERE conv_id = ?` 的等价物。
        "会话内搜索按 conv 扫全表（SQLite 侧 WHERE conv_id=? 的等价物）",
        "src/sdk/localStore.web.search.ts",
        """        const req = msgStore.index("ownerConv").getAll(`${owner}|${opts.convId}`);
        req.onsuccess = () => {
          for (const rec of (req.result as MsgRecord[]) ?? []) {
            if (rec.owner === owner && matchesQuery(rec, needle)) collected.push(rec);
          }
        };""",
        """        const req = msgStore.getAll();
        req.onsuccess = () => {
          for (const rec of (req.result as MsgRecord[]) ?? []) {
            if (rec.convId === opts.convId && matchesQuery(rec, needle)) collected.push(rec);
          }
        };""",
        "按 owner 隔离",
    ),
    Mutation(
        "被拒消息读回时漏抄 thumb（两份手抄字段表漏一侧）",
        "src/sdk/localStore.web.ts",
        """            convSeq: 0, timestamp: r.timestamp, status: "failed" as const, note: r.note,
            replyToConvSeq: r.replyToConvSeq, replySnapshot: r.replySnapshot, replyToFrom: r.replyToFrom, forwardFrom: r.forwardFrom,
            groupId: r.groupId, posterUrl: r.posterUrl,
            mediaW: r.mediaW, mediaH: r.mediaH, duration: r.duration, thumb: r.thumb, waveform: r.waveform,""",
        """            convSeq: 0, timestamp: r.timestamp, status: "failed" as const, note: r.note,
            replyToConvSeq: r.replyToConvSeq, replySnapshot: r.replySnapshot, replyToFrom: r.replyToFrom, forwardFrom: r.forwardFrom,
            groupId: r.groupId, posterUrl: r.posterUrl,
            mediaW: r.mediaW, mediaH: r.mediaH, duration: r.duration, waveform: r.waveform,""",
        "还原 failed",
    ),
    Mutation(
        "把合并改成「全字段保值」（即照旧 doc 的字面实现）",
        "src/sdk/localStore.types.ts",
        "    serverMsgId: rec.serverMsgId || existing?.serverMsgId,",
        "    serverMsgId: rec.serverMsgId || existing?.serverMsgId,\n    thumb: rec.thumb ?? existing?.thumb,",
        "受保护的",
    ),
    Mutation(
        "清空聊天记录时顺手把墓碑也清了",
        "src/sdk/localStore.web.ts",
        """      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.index("ownerConv").getAllKeys(cursorKeyOf(owner, convId));""",
        """      const tx = db.transaction([STORE, DELETIONS_STORE], "readwrite");
      const store = tx.objectStore(STORE);
      const del = tx.objectStore(DELETIONS_STORE);
      const dreq = del.index("ownerConv").getAllKeys(cursorKeyOf(owner, convId));
      dreq.onsuccess = () => { for (const k of (dreq.result as IDBValidKey[]) ?? []) del.delete(k); };
      const req = store.index("ownerConv").getAllKeys(cursorKeyOf(owner, convId));""",
        "不动墓碑",
    ),
    Mutation(
        # 「倒过来的区间不许登记」在 web 侧被守了**三遍**：store 的 `rangeTo >= rangeFrom` /
        # `hi >= lo`、addRange 的 `hi < lo`、normalizeRanges 的 `r.hi >= r.lo`。
        # 只拆一层另两层会接住，所以三层同时拆才证明得了断言是承重的。
        # 对 D4-3b 有实义：SQLite 实现若自己写 ranges 行、不走 addRange，那就只剩一层。
        "「倒过来的区间不许登记」三层防御同时拆掉",
        "src/sdk/ranges.ts",
        "    .filter((r) => Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.lo >= 1 && r.hi >= r.lo)",
        "    .filter((r) => Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.lo >= 1)",
        "不登记区间",
        (
            ("src/sdk/ranges.ts",
             "  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo || hi < 1) return normalizeRanges(ranges);",
             "  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < 1) return normalizeRanges(ranges);"),
            ("src/sdk/localStore.web.ts",
             "      if (rangeTo >= rangeFrom && rangeTo > 0) {",
             "      if (rangeTo > 0) {"),
            ("src/sdk/localStore.web.ranges.ts",
             "        merged = hi >= lo ? addRange(prev?.ranges ?? [], lo, hi) : normalizeRanges(prev?.ranges ?? []);",
             "        merged = addRange(prev?.ranges ?? [], lo, hi);"),
        ),
    ),
    Mutation(
        "删除目标为空时不再忽略，而是落到某条真消息上",
        "src/sdk/localStore.web.ts",
        "    : opts.clientMsgId ? rejectedKeyOf(owner, convId, opts.clientMsgId) : null;",
        "    : opts.clientMsgId ? rejectedKeyOf(owner, convId, opts.clientMsgId) : keyOf(owner, convId, 1);",
        "两个都没给",
    ),
    # ---- waveform 落库（2026-09-09 补的老账），两个读回分支各一条 ----
    Mutation(
        "落库漏掉 waveform（就是被修掉的那个老 bug 本身）",
        "src/sdk/localStore.web.ts",
        "    mediaW: m.mediaW, mediaH: m.mediaH, duration: m.duration, thumb: m.thumb, waveform: m.waveform,",
        "    mediaW: m.mediaW, mediaH: m.mediaH, duration: m.duration, thumb: m.thumb,",
        "字段整轮往返",
    ),
    Mutation(
        "被拒消息读回时漏抄 waveform",
        "src/sdk/localStore.web.ts",
        """            convSeq: 0, timestamp: r.timestamp, status: "failed" as const, note: r.note,
            replyToConvSeq: r.replyToConvSeq, replySnapshot: r.replySnapshot, replyToFrom: r.replyToFrom, forwardFrom: r.forwardFrom,
            groupId: r.groupId, posterUrl: r.posterUrl,
            mediaW: r.mediaW, mediaH: r.mediaH, duration: r.duration, thumb: r.thumb, waveform: r.waveform,""",
        """            convSeq: 0, timestamp: r.timestamp, status: "failed" as const, note: r.note,
            replyToConvSeq: r.replyToConvSeq, replySnapshot: r.replySnapshot, replyToFrom: r.replyToFrom, forwardFrom: r.forwardFrom,
            groupId: r.groupId, posterUrl: r.posterUrl,
            mediaW: r.mediaW, mediaH: r.mediaH, duration: r.duration, thumb: r.thumb,""",
        "还原 failed",
    ),
]

SQLITE_MUTATIONS: list[Mutation] = [

    Mutation(
        "conv_seq 列改成 TEXT（ORDER BY 变字典序：第 10 条排到第 2 条前）",
        ROWS, '  ["conv_seq", "INTEGER NOT NULL"],', '  ["conv_seq", "TEXT NOT NULL"],',
        "升序载回",
    ),
    Mutation(
        # 头一版这条写的 expect_hit 是「字段整轮往返」，结果红的是别的用例——因为那条往返用例
        # 把**每个字段都填满了**，根本走不到「缺省字段读回是什么」这条路，当时靠「受保护的
        # 只有那 5 个」（它断言 toBeUndefined）顺手兜住。已在契约里补了专门守这条的用例。
        "读回时 NULL 不还原成 undefined",
        ROWS, "const u = <T>(v: T | null): T | undefined => (v === null ? undefined : v);",
        "const u = <T>(v: T | null): T | undefined => (v as T | undefined);",
        "缺省字段读回",
    ),
    Mutation(
        "落库漏掉 thumb 列（SQLite 少建/少写一列）",
        ROWS, "    thumb: n(rec.thumb), waveform: n(rec.waveform),", "    thumb: null, waveform: n(rec.waveform),",
        "字段整轮往返",
    ),
    Mutation(
        "检索列不预先小写，改在查询时用 SQL 的 lower()（只折叠 ASCII）",
        ROWS, "    search_content: f.content.toLowerCase(),", "    search_content: f.content,",
        "非 ASCII",
        ((STORE, "            AND (m.search_content LIKE @like ESCAPE '\\\\'",
                 "            AND (lower(m.search_content) LIKE @like ESCAPE '\\\\'"),),
    ),
    Mutation(
        "LIKE 的元字符不转义（搜 50% 变成通配）",
        STORE, "  return s.replace(/[\\\\%_]/g, (c) => `\\\\${c}`);", "  return s;",
        "字面量",
    ),
    Mutation(
        "搜索漏掉墓碑过滤（删掉的消息会在搜索里复活）",
        STORE, """            AND NOT EXISTS (SELECT 1 FROM deletions d WHERE d.id = m.id)
            AND (m.search_content LIKE @like ESCAPE '\\\\'""",
        """            AND (m.search_content LIKE @like ESCAPE '\\\\'""",
        "被重同步落回来之后",
    ),
    Mutation(
        "会话内搜索漏掉 owner 条件（串到同机另一账号）",
        STORE, """          WHERE m.owner = ?
            AND (@conv IS NULL OR m.conv_id = @conv)""",
        """          WHERE (@conv IS NULL OR m.conv_id = @conv)""",
        "按 owner 隔离",
        ((STORE, """ORDER BY m.timestamp DESC, m.conv_seq DESC, m.id ASC
          LIMIT @limit`).all(owner, { conv, like, limit });""",
                 """ORDER BY m.timestamp DESC, m.conv_seq DESC, m.id ASC
          LIMIT @limit`).all({ conv, like, limit });"""),),
    ),
    Mutation(
        "读会话漏掉墓碑过滤",
        STORE, "            AND NOT EXISTS (SELECT 1 FROM deletions d WHERE d.id = m.id)\n          ORDER BY m.conv_seq ASC",
        "          ORDER BY m.conv_seq ASC",
        "重同步",
    ),
    Mutation(
        "合并白名单漏掉昵称保护",
        STORE, "    fromNickname: rec.fromNickname || existing?.fromNickname,", "    fromNickname: rec.fromNickname,",
        "稀疏重放",
    ),
    Mutation(
        "清空聊天记录时顺手把墓碑也清了",
        STORE, '        db.prepare("DELETE FROM messages WHERE owner = ? AND conv_id = ?").run(owner, convId);',
        '        db.prepare("DELETE FROM messages WHERE owner = ? AND conv_id = ?").run(owner, convId);\n'
        '        db.prepare("DELETE FROM deletions WHERE owner = ? AND conv_id = ?").run(owner, convId);',
        "不动墓碑",
    ),
    Mutation(
        "删除目标为空时不再忽略",
        STORE, "        : target.clientMsgId ? rejectedKeyOf(owner, convId, target.clientMsgId) : null;",
        "        : target.clientMsgId ? rejectedKeyOf(owner, convId, target.clientMsgId) : keyOf(owner, convId, 1);",
        "两个都没给",
    ),
    Mutation(
        "编辑正文后不清 mentionSpans",
        STORE, "              rec.mentionSpans = undefined;", "              /*MUT*/",
        "mentionSpans",
    ),
    Mutation(
        "updateRangesHead 顺手把 ranges 也清了",
        STORE, "          writeRanges(owner, convId, prev?.ranges ?? [], Math.max(prev?.head ?? 0, head));",
        "          writeRanges(owner, convId, [], Math.max(prev?.head ?? 0, head));",
        "绝不动 ranges",
    ),
    Mutation(
        "loadRanges 丢掉老库回退（老用户升级后被判成整个会话都是缺口）",
        STORE, "        const cursor = Math.max(0, Number(row?.conv_seq) || 0);", "        const cursor = 0;",
        "老库回退",
    ),
    Mutation(
        "游标改成从消息最大值推断",
        STORE, "        return Math.max(0, Number(row?.conv_seq) || 0);   // 无记录=0，**不从消息最大值推断**",
        "        return Math.max(0, Number(row?.conv_seq) || 0) || 9;",
        "无游标从 0 开始",
    ),
    Mutation(
        "搜索丢掉最终键 m.id（打平的行顺序由存储序决定，limit 会截出别的消息）",
        STORE, "          ORDER BY m.timestamp DESC, m.conv_seq DESC, m.id ASC",
        "          ORDER BY m.timestamp DESC, m.conv_seq DESC",
        "都打平时",
    ),
    Mutation(
        "空串 convId 不再当成全局搜索（`m.conv_id = ''` 谁也匹配不上 → 静默零结果）",
        STORE, "      const conv = opts.convId || null;", "      const conv = opts.convId ?? null;",
        "convId 空串",
    ),
    Mutation(
        "limit 不取整（SQLite 的 LIMIT 2.5 直接回零行）",
        STORE, "      const limit = Math.floor(opts.limit);", "      const limit = opts.limit;",
        "convId 空串",
    ),
]

SUITES = {
    "web": Suite("web（IndexedDB）", REPO, "src/sdk/localStore.contract.test.ts", WEB_MUTATIONS),
    "sqlite": Suite("desktop（主进程 SQLite）", DESKTOP, "test/sqliteStore.contract.test.ts", SQLITE_MUTATIONS),
}


def run_contract(suite: Suite) -> tuple[bool, str]:
    """跑一遍契约测试。返回 (是否全绿, 输出)。跑不起来一律按失败处理并留痕。"""
    try:
        done = subprocess.run(
            ["npx", "vitest", "run", suite.test_file],
            cwd=suite.cwd, capture_output=True, text=True, timeout=600,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        log.error("  跑测试失败（无法判定）：%s", exc)
        return False, str(exc)
    return done.returncode == 0, done.stdout + done.stderr


def restore(snapshots: dict[pathlib.Path, str]) -> None:
    """写回原文快照。还原失败必须整轮中止——留着改坏的实现比测试红危险得多。"""
    for path, text in snapshots.items():
        try:
            path.write_text(text, encoding="utf-8")
        except OSError as exc:
            log.error("  ⚠️ 还原 %s 失败（%s），请 git diff 检查", path, exc)
            raise SystemExit(2) from exc


def check(suite: Suite, mut: Mutation) -> bool:
    """一个变异体的完整回合：快照 → 改坏 → 跑 → 写回快照。测试必须变红且命中预期用例。"""
    snapshots: dict[pathlib.Path, str] = {}
    try:
        for rel, old, new in mut.edits():
            path = suite.cwd / rel
            snapshots.setdefault(path, path.read_text(encoding="utf-8"))
            text = path.read_text(encoding="utf-8")
            if text.count(old) != 1:
                log.error("  %r 在 %s 里出现 %d 次（要求恰好 1 次）——多半是实现改了、变异锚点没跟",
                          old[:50], rel, text.count(old))
                restore(snapshots)
                return False
            path.write_text(text.replace(old, new, 1), encoding="utf-8")
    except OSError as exc:
        log.error("  改坏实现时出错：%s", exc)
        restore(snapshots)
        return False
    try:
        green, out = run_contract(suite)
    finally:
        restore(snapshots)
    if green:
        log.error("  ✗ 改坏了实现，契约却还是绿的 —— 这条断言不算数")
        return False
    if mut.expect_hit not in out:
        log.error("  ✗ 红了，但红的不是预期那条（找不到 %r）", mut.expect_hit)
        return False
    log.info("  ✓ 红了，且命中「%s」", mut.expect_hit)
    return True


def run_suite(suite: Suite) -> bool:
    log.info("========== %s：%d 个变异 ==========", suite.name, len(suite.mutations))
    green, _ = run_contract(suite)
    if not green:
        log.error("基线就不是绿的，先修好再跑变异验证")
        return False
    bad: list[str] = []
    for mut in suite.mutations:
        log.info("变异：%s", mut.name)
        if not check(suite, mut):
            bad.append(mut.name)
    if bad:
        log.error("✗ %d/%d 个变异没被抓住：%s", len(bad), len(suite.mutations), "；".join(bad))
        return False
    log.info("✓ %d 个变异全部被契约抓住\n", len(suite.mutations))
    return True


def main(argv: list[str]) -> int:
    wanted = argv[1:] or list(SUITES)
    unknown = [a for a in wanted if a not in SUITES]
    if unknown:
        log.error("未知的套件：%s（可选：%s）", "、".join(unknown), "、".join(SUITES))
        return 2
    return 0 if all(run_suite(SUITES[name]) for name in wanted) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
