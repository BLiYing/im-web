import { describe, it, expect } from "vitest";
import { changedTranscriptSeqs, revealDelta } from "./useVoiceTranscript";

describe("changedTranscriptSeqs", () => {
  it("新展开 / 结果到达 / 文本改写 都算变高", () => {
    expect(changedTranscriptSeqs({}, { 7: "" })).toEqual([7]);              // → 识别中…
    expect(changedTranscriptSeqs({ 7: "" }, { 7: "你好" })).toEqual([7]);   // 识别中… → 文本
    expect(changedTranscriptSeqs({ 7: "你好" }, { 7: "你好呀" })).toEqual([7]);
  });

  it("收起（有→无）不算：内容只会变矮，滚了反而把人拽走", () => {
    expect(changedTranscriptSeqs({ 7: "你好" }, {})).toEqual([]);
  });

  it("没变的条目不重复上报（一次点击只该补一条）", () => {
    expect(changedTranscriptSeqs({ 7: "你好", 9: "在" }, { 7: "你好", 9: "在", 11: "" })).toEqual([11]);
  });
});

describe("revealDelta", () => {
  const box = { top: 0, bottom: 600 };
  it("已完整可见 → 不滚", () => {
    expect(revealDelta({ top: 100, bottom: 300 }, box)).toBe(0);
    expect(revealDelta({ top: 400, bottom: 600 }, box)).toBe(0);
  });

  it("底部露在视口外 → 只补露出来的那一截", () => {
    expect(revealDelta({ top: 500, bottom: 680 }, box)).toBe(80);
  });

  it("行比视口还高 → 最多补到行顶贴容器顶（不把开头顶出去）", () => {
    expect(revealDelta({ top: 40, bottom: 900 }, box)).toBe(40);
  });

  it("行顶已在容器顶之上 → 一步不动（再滚只会丢掉更多开头）", () => {
    expect(revealDelta({ top: -120, bottom: 700 }, box)).toBe(0);
  });
});
