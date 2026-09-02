import { describe, it, expect } from "vitest";
import { addRange, coversSpan, gapBefore, hasSeq, isComplete, rangeContaining } from "./ranges";

/**
 * 「跨缺口拼接」——本轮改造**新引入**的一类风险，专门钉住。
 *
 * 在留缺口之前，本地库要么齐全要么只是尾巴短一截，"取更早的一页"永远是连着的。
 * 有了缺口之后，本地同时存着缺口**两侧**的消息：直接按"取 conv_seq < lo 的若干条"去查，
 * 会从另一侧的旧岛捞出来接到窗口顶部——两段不相邻的历史被静默拼在一起。
 *
 * 失效方式极隐蔽：界面照常渲染、时间戳仍然递增、滚动手感也正常，
 * 只是中间少了几万条，而且**没有任何提示**。所以判据必须是可测的纯函数。
 */
describe("跨缺口拼接的判据", () => {
  // 典型大群积压形态：旧的一段 + 最新一段，中间十万条从未下载。
  const GAPPED = addRange([{ lo: 1, hi: 1200 }], 99_800, 100_000);

  it("两段之间确实是缺口", () => {
    expect(isComplete(GAPPED, 100_000)).toBe(false);
    expect(hasSeq(GAPPED, 1200)).toBe(true);
    expect(hasSeq(GAPPED, 1201)).toBe(false);
    expect(hasSeq(GAPPED, 50_000)).toBe(false);
  });

  it("段起点判据：站在新段顶部时，本地不可用（必须问服务端）", () => {
    // 用户翻到 99800（新段最上面那条）。同段里没有更早的了。
    const seg = rangeContaining(GAPPED, 99_800);
    expect(seg).toEqual({ lo: 99_800, hi: 100_000 });
    expect(seg!.lo < 99_800).toBe(false); // ← 这个 false 就是"别用本地"
  });

  it("段起点判据：段中间时本地可用", () => {
    const seg = rangeContaining(GAPPED, 99_900);
    expect(seg!.lo < 99_900).toBe(true);
  });

  it("gapBefore 给出的下一段落在缺口里，不会跳到旧岛上", () => {
    // 从 99800 往前要一页 200 条 → [99600, 99799]，正好贴着缺口边缘往回收，
    // 而不是"本地有 1200 那一段，就把 1001..1200 拿来用"。
    expect(gapBefore(GAPPED, 99_800, 200)).toEqual({ lo: 99_600, hi: 99_799 });
  });

  it("缺口逐页收窄，最终与旧段合并", () => {
    let rs = GAPPED;
    // 模拟用户一直往上翻：每页 200 条。
    let anchor = 99_800;
    for (let i = 0; i < 3; i++) {
      const next = gapBefore(rs, anchor, 200)!;
      rs = addRange(rs, next.lo, next.hi);
      anchor = next.lo;
    }
    expect(rangeContaining(rs, 99_800)).toEqual({ lo: 99_200, hi: 100_000 });
    expect(isComplete(rs, 100_000)).toBe(false); // 还没接上旧段
    // 一口气补齐中间剩下的
    rs = addRange(rs, 1201, 99_199);
    expect(isComplete(rs, 100_000)).toBe(true);
  });

  it("coversSpan 不接受跨段覆盖——窗口取数不能横跨缺口", () => {
    // 想要 [1100, 99900] 这一窗？本地看着"两头都有"，但中间是空的。
    expect(coversSpan(GAPPED, 1100, 99_900)).toBe(false);
  });
});
