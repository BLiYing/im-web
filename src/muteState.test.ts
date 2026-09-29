// 三端共用向量（testing/muteState.vectors.json，源 IMServer docs/conformance/mute_state.json）。
// 精确复刻 alertDecision.test.ts 读向量的写法。
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import vectors from "./testing/muteState.vectors.json";
import { isMutedNow, muteUntilLabel, muteUntilForDuration, MUTE_DURATION_OPTIONS, type MuteDurationId } from "./muteState";

interface IsMutedCase { name: string; muted: boolean; muteUntil: number; nowMs: number; expect: boolean }
interface UntilLabelCase {
  name: string; muteUntil: number; nowMs: number; tzOffsetMinutes: number;
  expect: { kind: string; time: string | null; month: number | null; day: number | null };
}

describe("mute_state 共用向量", () => {
  for (const c of (vectors as { isMutedNow: IsMutedCase[] }).isMutedNow) {
    it(`isMutedNow: ${c.name}`, () => {
      expect(isMutedNow(c.muted, c.muteUntil, c.nowMs)).toBe(c.expect);
    });
  }

  for (const c of (vectors as { untilLabel: UntilLabelCase[] }).untilLabel) {
    it(`muteUntilLabel: ${c.name}`, () => {
      expect(muteUntilLabel(c.muteUntil, c.nowMs, c.tzOffsetMinutes)).toEqual(c.expect);
    });
  }

  it("本地副本与源向量一致（源在本机时才比）", () => {
    const src = "IMServer/docs/conformance/mute_state.json";
    const abs = new URL(`../../${src}`, import.meta.url);
    if (!existsSync(abs)) return;
    expect(JSON.parse(readFileSync(abs, "utf8"))).toEqual(vectors);
  });
});

describe("isMutedNow 边界（向量之外，补几条防回归）", () => {
  it("mute_until 为 undefined 时按 0（永久）处理", () => {
    expect(isMutedNow(true, undefined, Date.now())).toBe(true);
  });
  it("muted=false 时无论 mute_until 是什么都不算免打扰", () => {
    expect(isMutedNow(false, 0, Date.now())).toBe(false);
    expect(isMutedNow(false, Date.now() + 1000, Date.now())).toBe(false);
  });
});

describe("muteUntilForDuration：时长选择 → mute_until 绝对时间戳（§4.1）", () => {
  const now = 1_700_000_000_000;
  const cases: [MuteDurationId, number][] = [
    ["1h", 3_600_000],
    ["8h", 8 * 3_600_000],
    ["1d", 24 * 3_600_000],
    ["7d", 7 * 24 * 3_600_000],
  ];
  for (const [id, deltaMs] of cases) {
    it(`${id} = now + ${deltaMs}ms`, () => {
      expect(muteUntilForDuration(id, now)).toBe(now + deltaMs);
    });
  }
  it("forever = 0（不管 now 是什么）", () => {
    expect(muteUntilForDuration("forever", now)).toBe(0);
  });
  it("选项顺序固定：1 小时/8 小时/1 天/7 天/永久（对齐 UX 稿 §4.1，不做自定义到某天）", () => {
    expect(MUTE_DURATION_OPTIONS.map((o) => o.id)).toEqual(["1h", "8h", "1d", "7d", "forever"]);
  });
});
