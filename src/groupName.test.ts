import { describe, expect, it } from "vitest";
import { defaultGroupName, publicNameOf, runeLength, truncateRunes } from "./groupName";

// 与 iOS 的 IMGroupNameDefaultTests 同一组用例：两端规则必须逐字一致，
// 否则同一批人在两个端上建群会得到不同的默认群名。

describe("publicNameOf", () => {
  it("昵称 → @用户名 → uid 依次回退", () => {
    expect(publicNameOf({ nickname: "小明", username: "ming", user_id: "1001" })).toBe("小明");
    expect(publicNameOf({ nickname: "  ", username: "ming", user_id: "1001" })).toBe("@ming");
    expect(publicNameOf({ user_id: "1001" })).toBe("1001");
    expect(publicNameOf({})).toBe("");
  });
});

describe("defaultGroupName", () => {
  it("按顺序用「、」连接（调用方把自己排在第一位）", () => {
    expect(defaultGroupName(["小明", "张三", "李四"])).toBe("小明、张三、李四");
  });

  it("跳过空名字", () => {
    expect(defaultGroupName(["小明", "", "  ", "张三"])).toBe("小明、张三");
    expect(defaultGroupName([])).toBe("");
    expect(defaultGroupName(["", " "])).toBe("");
  });

  it("刚好放得下就不补「…」", () => {
    // 6+1+5+1+4+1+4+1+4 = 27 ≤ 30，五个名字全进去
    const out = defaultGroupName(["产品经理小王", "设计师小李", "前端小张", "后端小赵", "测试小孙"]);
    expect(out).toBe("产品经理小王、设计师小李、前端小张、后端小赵、测试小孙");
    expect(runeLength(out)).toBe(27);
  });

  it("放不下下一个名字就到此为止，**不补省略号**", () => {
    // 每个 6 字：6 / 13 / 20 / 27 都放得下，第 5 个要到 34 → 停在 4 个
    const out = defaultGroupName(Array(5).fill("一二三四五六"));
    expect(out).toBe("一二三四五六、一二三四五六、一二三四五六、一二三四五六");
    expect(runeLength(out)).toBe(27);
    expect(out.endsWith("…")).toBe(false);
  });

  it("上限收得很紧时只留放得下的那些", () => {
    expect(defaultGroupName(["一二三四五六", "一二三四五六"], 10)).toBe("一二三四五六");
  });

  it("第一个名字本身就超长 → 硬截到上限（同样不补省略号）", () => {
    expect(defaultGroupName(["字".repeat(40)])).toBe("字".repeat(30));
    expect(runeLength(defaultGroupName(["字".repeat(40)]))).toBe(30);
  });

  it("emoji 按 1 个 rune 计（与服务端 len([]rune) 同口径）", () => {
    expect(runeLength("😀😀😀")).toBe(3);
    expect(truncateRunes("😀😀😀", 2)).toBe("😀😀");
    expect(defaultGroupName(["😀".repeat(20), "张三"], 10)).toBe("😀".repeat(10));
  });
});
