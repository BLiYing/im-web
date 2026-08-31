import { describe, it, expect } from "vitest";
import { parseConvBumpItems } from "./convBump";

// conv_bump 的 payload 来自网络：字段可能缺、类型可能不对、items 可能压根不是数组。
// 解析层的契约是「丢弃坏条目而不抛」——一条坏信号不该让整帧、乃至整条连接的分发循环挂掉。
describe("parseConvBumpItems", () => {
  it("解出正常条目", () => {
    const items = parseConvBumpItems({
      items: [{ conv_id: "g_1", latest_seq: 42, from: "u1", from_nickname: "小明", preview: "在吗" }],
    });
    expect(items).toEqual([
      { conv_id: "g_1", latest_seq: 42, from: "u1", from_nickname: "小明", preview: "在吗" },
    ]);
  });

  it("items 缺失/非数组 → 空集合，不抛", () => {
    expect(parseConvBumpItems(undefined)).toEqual([]);
    expect(parseConvBumpItems({})).toEqual([]);
    expect(parseConvBumpItems({ items: "nope" })).toEqual([]);
    expect(parseConvBumpItems({ items: null })).toEqual([]);
  });

  it("丢弃坏条目但保留同帧里的好条目", () => {
    const items = parseConvBumpItems({
      items: [
        null,
        "字符串不是条目",
        { latest_seq: 9 },              // 缺 conv_id → 丢
        { conv_id: "", latest_seq: 9 }, // 空 conv_id → 丢
        { conv_id: "g_ok", latest_seq: 7 },
      ],
    });
    expect(items.map((i) => i.conv_id)).toEqual(["g_ok"]);
  });

  it("latest_seq 非数值按 0 处理（调用方会与本地位点比较，0 表示不用拉）", () => {
    const items = parseConvBumpItems({ items: [{ conv_id: "g_1", latest_seq: "42" }] });
    expect(items[0].latest_seq).toBe(0);
  });

  it("可选字段类型不对时留空而不是塞进脏值", () => {
    const items = parseConvBumpItems({
      items: [{ conv_id: "g_1", latest_seq: 1, from: 123, from_nickname: {}, preview: [] }],
    });
    expect(items[0].from).toBeUndefined();
    expect(items[0].from_nickname).toBeUndefined();
    expect(items[0].preview).toBeUndefined();
  });
});
