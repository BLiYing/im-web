import { describe, expect, it } from "vitest";
import { RECENT_ADDED_DAYS, RECENT_ADDED_MAX, recentAdded } from "./friendRequests";
import type { FriendEntry } from "./sdk/protocol";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const f = (id: string, updated_at: number, status = "accepted"): FriendEntry =>
  ({ user_id: id, status, updated_at } as FriendEntry);

describe("recentAdded", () => {
  it("常量口径：30 天 / 50 条", () => {
    expect(RECENT_ADDED_DAYS).toBe(30);
    expect(RECENT_ADDED_MAX).toBe(50);
  });

  it("边界：恰好 30 天前保留，早 1ms 剔除（毫秒单位）", () => {
    const r = recentAdded([f("edge", NOW - 30 * DAY), f("old", NOW - 30 * DAY - 1)], NOW);
    expect(r.map((x) => x.user_id)).toEqual(["edge"]);
  });

  it("只留 accepted，pending/requested 剔除", () => {
    const r = recentAdded([f("a", NOW), f("p", NOW, "pending"), f("q", NOW, "requested")], NOW);
    expect(r.map((x) => x.user_id)).toEqual(["a"]);
  });

  it("updated_at 倒序，且不改入参", () => {
    const input = [f("a", NOW - 3 * DAY), f("b", NOW - 1 * DAY), f("c", NOW - 2 * DAY)];
    expect(recentAdded(input, NOW).map((x) => x.user_id)).toEqual(["b", "c", "a"]);
    expect(input.map((x) => x.user_id)).toEqual(["a", "b", "c"]);
  });

  it("最多 50 条，保留最新的 50", () => {
    const many = Array.from({ length: 80 }, (_, i) => f(`u${i}`, NOW - i * 1000));
    const r = recentAdded(many, NOW);
    expect(r).toHaveLength(RECENT_ADDED_MAX);
    expect(r[0].user_id).toBe("u0");
    expect(r[49].user_id).toBe("u49");
  });

  it("空输入返回空数组", () => {
    expect(recentAdded([], NOW)).toEqual([]);
  });
});
