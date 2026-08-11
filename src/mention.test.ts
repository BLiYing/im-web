import { describe, it, expect } from "vitest";
import {
  activeMentionQuery,
  applyMentionToken,
  resolveMentions,
  resolveMentionAll,
  filterMentionMembers,
  canMentionAll,
  containsMentionToken,
  countsAsUnread,
  MENTION_ALL_LABEL,
} from "./mention";

describe("activeMentionQuery", () => {
  it("刚键入 @ 时返回空串（面板该弹出、显示全员）", () => {
    expect(activeMentionQuery("@", 1)).toBe("");
    expect(activeMentionQuery("你好 @", 4)).toBe("");
  });

  it("@ 后的字符即查询词", () => {
    expect(activeMentionQuery("@小", 2)).toBe("小");
    expect(activeMentionQuery("在吗 @小美", 6)).toBe("小美");
  });

  it("@ 后出现空白即结束提及态（用户在正常打字）", () => {
    expect(activeMentionQuery("@小美 麻烦你", 6)).toBeNull();
    expect(activeMentionQuery("@小美 ", 4)).toBeNull();
  });

  it("认全角 ＠（中文输入法）", () => {
    expect(activeMentionQuery("＠小", 2)).toBe("小");
  });

  it("无 @ / 空文本 / 越界光标一律返回 null", () => {
    expect(activeMentionQuery("你好", 2)).toBeNull();
    expect(activeMentionQuery("", 0)).toBeNull();
    expect(activeMentionQuery("@x", 99)).toBeNull();
  });

  it("取的是光标前最近的 @，不受后面文本影响", () => {
    // 光标停在 "@李" 之后，后面还有旧 token —— 查询词应是"李"。
    expect(activeMentionQuery("@小美 的事 @李 后面", 9)).toBe("李");
  });
});

describe("applyMentionToken", () => {
  it("把正在输入的 @query 整体替换为 `@显示名 `", () => {
    const r = applyMentionToken("@小", 2, "小美");
    expect(r.text).toBe("@小美 ");
    expect(r.caret).toBe(4); // 光标落在尾随空格之后
  });

  it("保留 @ 之前与光标之后的文本", () => {
    const r = applyMentionToken("在吗 @小 后面", 5, "小美");
    expect(r.text).toBe("在吗 @小美 后面"); // 光标后已有空格 → token 不再补尾空格，避免双空格
  });

  it("可连续 @ 第二个人", () => {
    const first = applyMentionToken("@", 1, "小美");
    const second = applyMentionToken(first.text + "@", first.text.length + 1, "李雷");
    expect(second.text).toBe("@小美 @李雷 ");
  });

  it("没有 @ 时在光标处插入（工具栏按钮触发的兜底）", () => {
    const r = applyMentionToken("你好", 2, "小美");
    expect(r.text).toBe("你好@小美 ");
  });
});

describe("resolveMentions", () => {
  const candidates = { "1002": "小美", "1003": "李雷" }; // uid → 显示名

  it("只保留文本里仍留着 token 的候选", () => {
    expect(resolveMentions("@小美 在吗", candidates)).toEqual(["1002"]);
    expect(resolveMentions("@小美 @李雷 开会", candidates)).toEqual(["1002", "1003"]);
  });

  it("用户删掉 token 后就不再 @ 他（核心：不能凭记忆发 mentions）", () => {
    expect(resolveMentions("在吗", candidates)).toEqual([]);
  });

  it("空文本 / 空候选返回空数组", () => {
    expect(resolveMentions("", candidates)).toEqual([]);
    expect(resolveMentions("@小美", {})).toEqual([]);
  });

  it("同一人重复出现只算一次", () => {
    expect(resolveMentions("@小美 @小美 在吗", candidates)).toEqual(["1002"]);
  });
});

describe("resolveMentionAll", () => {
  it("标记 + 文本 token 同时在才生效", () => {
    expect(resolveMentionAll(`@${MENTION_ALL_LABEL} 开会`, true)).toBe(true);
    expect(resolveMentionAll("开会", true)).toBe(false); // 选过但把 token 删了
    expect(resolveMentionAll(`@${MENTION_ALL_LABEL} 开会`, false)).toBe(false); // 没选过
  });
});

describe("filterMentionMembers", () => {
  const members = [
    { userId: "1002", displayName: "小美" },
    { userId: "1003", displayName: "小刚" },
    { userId: "1004", displayName: "李雷" },
  ];

  it("按昵称子串过滤", () => {
    expect(filterMentionMembers(members, "小").map((m) => m.userId)).toEqual(["1002", "1003"]);
  });

  it("按 uid 也能命中", () => {
    expect(filterMentionMembers(members, "1004").map((m) => m.displayName)).toEqual(["李雷"]);
  });

  it("空 query 返回全部", () => {
    expect(filterMentionMembers(members, "  ")).toHaveLength(3);
  });
});

describe("canMentionAll", () => {
  it("仅群主/管理员", () => {
    expect(canMentionAll("owner")).toBe(true);
    expect(canMentionAll("admin")).toBe(true);
    expect(canMentionAll("member")).toBe(false);
    expect(canMentionAll(undefined)).toBe(false);
  });
});

describe("containsMentionToken（token 边界，防前缀误命中）", () => {
  it("完整 token：后接空白或到结尾都算", () => {
    expect(containsMentionToken("@小美 在吗", "小美")).toBe(true);
    expect(containsMentionToken("在吗 @小美", "小美")).toBe(true);
    expect(containsMentionToken("@小美\n换行", "小美")).toBe(true);
  });

  it("昵称互为前缀时不得误命中（回归：@小美丽 曾把小美也算进去）", () => {
    expect(containsMentionToken("@小美丽 开会", "小美")).toBe(false);
    expect(containsMentionToken("@小美丽 开会", "小美丽")).toBe(true);
  });

  it("同一文本里既有长名又有短名时，短名仍能命中自己的 token", () => {
    expect(containsMentionToken("@小美丽 和 @小美 都来", "小美")).toBe(true);
  });

  it("空输入返回 false", () => {
    expect(containsMentionToken("", "小美")).toBe(false);
    expect(containsMentionToken("@小美", "")).toBe(false);
  });
});

describe("resolveMentions（uid 为键，同名成员不互相覆盖）", () => {
  it("两个同名成员都能各自被 @（回归：以显示名为键时后者会覆盖前者）", () => {
    const dup = { "1002": "小明", "1003": "小明" };
    expect(resolveMentions("@小明 在吗", dup).sort()).toEqual(["1002", "1003"]);
  });

  it("前缀昵称不被误算（回归）", () => {
    const c = { "1002": "小美", "1003": "小美丽" };
    expect(resolveMentions("@小美丽 开会", c)).toEqual(["1003"]);
  });
});

describe("resolveMentionAll（同样按 token 边界）", () => {
  it("「@所有人们」这类更长的词不应触发 @所有人", () => {
    expect(resolveMentionAll("@所有人们 好", true)).toBe(false);
    expect(resolveMentionAll(`@${MENTION_ALL_LABEL} 好`, true)).toBe(true);
  });
});

describe("countsAsUnread（与服务端未读口径一致）", () => {
  it("system / msg_op 不计未读，其余计入", () => {
    expect(countsAsUnread("system")).toBe(false);
    expect(countsAsUnread("msg_op")).toBe(false);
    expect(countsAsUnread("text")).toBe(true);
    expect(countsAsUnread("image")).toBe(true);
    expect(countsAsUnread(undefined)).toBe(true);
  });
});
