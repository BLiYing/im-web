import { describe, it, expect } from "vitest";
import { ALBUM_MAX, ALBUM_GROUP_ID_PREFIX, planAlbumBatch, albumOverflowToast, albumGridCapacity } from "./albumBatch";

// 发号器：每调一次给一个可辨认的新 id，用来断言"只生成了一个 group_id、且整批共享它"。
const seqIds = () => { let n = 0; return () => `id${++n}`; };

describe("planAlbumBatch — 一批媒体怎么成为一个宫格", () => {
  it("≥2 件共享同一个 alb- 前缀 group_id（与 iOS/Android 一致）", () => {
    const p = planAlbumBatch(["a", "b", "c"], { newId: seqIds() });
    expect(p.groupId).toBe(`${ALBUM_GROUP_ID_PREFIX}id1`);
    expect(p.batch).toEqual(["a", "b", "c"]);
    expect(p.dropped).toBe(0);
  });

  it("1 件不带 group_id（普通媒体气泡，不是单格宫格）", () => {
    const p = planAlbumBatch(["only"], { newId: seqIds() });
    expect(p.groupId).toBeUndefined();
    expect(p.batch).toEqual(["only"]);
  });

  it("0 件：不发也不生成 group_id", () => {
    const p = planAlbumBatch([], { newId: seqIds() });
    expect(p.batch).toEqual([]);
    expect(p.groupId).toBeUndefined();
    expect(p.dropped).toBe(0);
  });

  it("保持用户选择顺序（异步上传不得打乱发送次序，这里先保证入口顺序）", () => {
    const picked = ["3.jpg", "1.jpg", "2.jpg"];
    expect(planAlbumBatch(picked, { newId: seqIds() }).batch).toEqual(["3.jpg", "1.jpg", "2.jpg"]);
  });

  it(`超过 ${ALBUM_MAX} 件：截前 ${ALBUM_MAX} 件、dropped 记多出的，绝不静默全发`, () => {
    const items = Array.from({ length: 12 }, (_, i) => `f${i}`);
    const p = planAlbumBatch(items, { newId: seqIds() });
    expect(p.batch).toHaveLength(ALBUM_MAX);
    expect(p.batch[0]).toBe("f0");
    expect(p.batch[ALBUM_MAX - 1]).toBe(`f${ALBUM_MAX - 1}`);
    expect(p.dropped).toBe(3);
  });

  it("恰好 9 件：不截断、不提示", () => {
    const items = Array.from({ length: ALBUM_MAX }, (_, i) => `f${i}`);
    const p = planAlbumBatch(items, { newId: seqIds() });
    expect(p.batch).toHaveLength(ALBUM_MAX);
    expect(p.dropped).toBe(0);
    expect(albumOverflowToast(p.dropped)).toBeNull();
  });

  it("显式 groupId 一律沿用——含只剩 1 件的重试（否则失败的那格重试后会掉出宫格）", () => {
    const newId = seqIds();
    const p = planAlbumBatch(["retry-me"], { groupId: "alb-old", newId });
    expect(p.groupId).toBe("alb-old");
    // 没有新生成任何 id：发号器一次都不该被调到。
    expect(newId()).toBe("id1");
  });

  it("整批只生成一个 group_id（不是每件一个）", () => {
    const p = planAlbumBatch(["a", "b", "c", "d"], { newId: seqIds() });
    expect(p.groupId).toBe(`${ALBUM_GROUP_ID_PREFIX}id1`);
  });
});

describe("albumOverflowToast", () => {
  it("dropped=0 → null（不打扰用户）", () => {
    expect(albumOverflowToast(0)).toBeNull();
  });
  it("dropped>0 → 说清上限与被忽略的件数", () => {
    expect(albumOverflowToast(3)).toBe(`一次最多发送 ${ALBUM_MAX} 个，已忽略后面的 3 个`);
  });
});

describe("上限与渲染排布自洽", () => {
  // 改了 ALBUM_MAX 却没改 albumRowPattern（或反过来）→ 第 10 件会被 AlbumGrid 的 slice 悄悄吃掉。
  it("albumRowPattern(ALBUM_MAX) 的格子数正好等于 ALBUM_MAX", () => {
    expect(albumGridCapacity()).toBe(ALBUM_MAX);
  });
});
