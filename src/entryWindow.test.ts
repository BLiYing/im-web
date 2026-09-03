import { describe, it, expect } from "vitest";
import { entryWindowSince } from "./entryWindow";

const base = { contextBefore: 10, historyPage: 200 };

describe("进会话取哪一窗", () => {
  it("有未读 → 锚到首条未读附近", () => {
    expect(entryWindowSince({ ...base, readSeq: 500, latestSeq: 900, unread: 400 })).toBe(490);
  });

  it("无未读 → 最近一页，贴底", () => {
    expect(entryWindowSince({ ...base, readSeq: 900, latestSeq: 900, unread: 0 })).toBe(700);
  });

  it("发送方：unread=0 但读位点远落后于自己发的消息 → 仍取最近一页", () => {
    // 压测现场：user1001 灌了 1 万条到群里，那些都是它自己发的。服务端未读排除本人消息 → unread=0，
    // 而 read_seq 停在灌之前。判据若用 latestSeq > readSeq 就会锚到一万条之前（旧 bug）。
    const since = entryWindowSince({ ...base, readSeq: 100019, latestSeq: 110019, unread: 0 });
    expect(since).toBe(109819);                 // = latest - 一页，即最近一页
    expect(since).toBeGreaterThan(100019);      // 绝不能落在旧读位点附近
  });

  it("从没读过（readSeq=0）→ 最近一页，不拿 0 当锚点", () => {
    expect(entryWindowSince({ ...base, readSeq: 0, latestSeq: 900, unread: 900 })).toBe(700);
  });

  it("会话很短时不出负数", () => {
    expect(entryWindowSince({ ...base, readSeq: 0, latestSeq: 3, unread: 0 })).toBe(0);
    expect(entryWindowSince({ ...base, readSeq: 2, latestSeq: 3, unread: 1 })).toBe(0);
  });
});
