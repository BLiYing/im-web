// 会话列表编辑模式选择集：读三端共用向量（testing/convSelection.vectors.json，源 IMServer docs/conformance/conv_selection.json）。
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import vectors from "./testing/convSelection.vectors.json";
import type { Conversation } from "./sdk/protocol";
import {
  EMPTY_SELECTION, convHasUnread, hasUnreadIn, isAllSelectedIn, pruneTo, runBounded, selectAllIn, selectRangeIn,
  selectedIn, toggleSel, type ConvSelection,
} from "./convSelection";

interface VConv { id: string; unread: number; marked: boolean }
type Op = ["toggle", string] | ["select_all"] | ["clear"] | ["prune", string[]];
interface Scenario { name: string; convs: VConv[]; ops: Op[]; expect: { ids: string[]; all_selected: boolean; has_unread: boolean } }

const conv = (v: VConv) => ({ conv_id: v.id, unread: v.unread, marked_unread: v.marked }) as unknown as Conversation;
const V = vectors as unknown as { has_unread: { name: string; unread: number; marked: boolean; expect: boolean }[]; scenarios: Scenario[] };

describe("conv_selection 共用向量", () => {
  it("向量条数", () => {
    expect(V.has_unread.length).toBeGreaterThanOrEqual(4);
    expect(V.scenarios.length).toBeGreaterThanOrEqual(9);
  });
  for (const c of V.has_unread) {
    it(`有未读：${c.name}`, () => expect(convHasUnread(conv({ id: "x", unread: c.unread, marked: c.marked }))).toBe(c.expect));
  }
  for (const s of V.scenarios) {
    it(`场景：${s.name}`, () => {
      let list = s.convs.map(conv);
      let sel: ConvSelection = EMPTY_SELECTION;
      for (const op of s.ops) {
        if (op[0] === "toggle") sel = toggleSel(sel, op[1]);
        else if (op[0] === "select_all") sel = selectAllIn(sel, list);
        else if (op[0] === "clear") sel = EMPTY_SELECTION;
        else { const keep = new Set(op[1]); list = list.filter((c) => keep.has(c.conv_id)); sel = pruneTo(sel, list); }
      }
      expect([...sel].sort()).toEqual(s.expect.ids);
      expect(isAllSelectedIn(sel, list)).toBe(s.expect.all_selected);
      expect(hasUnreadIn(sel, list)).toBe(s.expect.has_unread);
    });
  }
  it("本地副本与源向量一致（源在本机时才比）", () => {
    const abs = new URL("../../IMServer/docs/conformance/conv_selection.json", import.meta.url);
    if (!existsSync(abs)) return;
    expect(JSON.parse(readFileSync(abs, "utf8"))).toEqual(vectors);
  });
});

describe("选择集辅助", () => {
  const list = ["a", "b", "c", "d"].map((id) => conv({ id, unread: 0, marked: false }));
  it("按列表顺序取出已选", () => {
    const sel = toggleSel(toggleSel(EMPTY_SELECTION, "c"), "a");
    expect(selectedIn(sel, list).map((c) => c.conv_id)).toEqual(["a", "c"]);
  });
  it("Shift 连选：含两端，方向无关；端点不存在则原样返回", () => {
    expect([...selectRangeIn(EMPTY_SELECTION, list, "d", "b")].sort()).toEqual(["b", "c", "d"]);
    const sel = toggleSel(EMPTY_SELECTION, "a");
    expect(selectRangeIn(sel, list, "a", "zzz")).toBe(sel);
  });
  it("pruneTo 没变化时返回原对象", () => {
    const sel = toggleSel(EMPTY_SELECTION, "a");
    expect(pruneTo(sel, list)).toBe(sel);
  });
});

describe("runBounded", () => {
  it("限并发并分组成败", async () => {
    let inflight = 0, peak = 0;
    const r = await runBounded([...Array(10).keys()], 3, async (i) => {
      inflight++; peak = Math.max(peak, inflight);
      await new Promise((res) => setTimeout(res, 5));
      inflight--;
      if (i % 4 === 0) throw new Error("boom");
    });
    expect(r.failed).toEqual([0, 4, 8]);
    expect(r.succeeded.length).toBe(7);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
  it("空列表直接返回", async () => {
    expect(await runBounded([], 4, async () => { throw new Error("不该被调用"); })).toEqual({ succeeded: [], failed: [] });
  });
});
