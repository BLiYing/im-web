// 多选批量举报的判定 + 多选勾选上限（2026-09-06）。两端同语义：iOS `reportableSenderForMessages:`。
import { describe, it, expect } from "vitest";
import { reportableSenderOf, SELECT_MAX } from "./messageContent";
import type { ChatMessage } from "./sdk/protocol";

const m = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  convId: "c1", from: "u2", content: "x", contentType: "text", convSeq: 7, timestamp: 1, status: "sent", ...over,
} as ChatMessage);

describe("reportableSenderOf", () => {
  const uid = "u1";

  it("全是同一个对方发的 → 回那个发送者", () => {
    expect(reportableSenderOf([m({ convSeq: 1 }), m({ convSeq: 2 }), m({ convSeq: 3 })], uid)).toBe("u2");
  });

  it("单条也算（多选只勾一条时举报钮同样可用）", () => {
    expect(reportableSenderOf([m({ convSeq: 1 })], uid)).toBe("u2");
  });

  it("含我自己发的 → null（不能举报自己）", () => {
    expect(reportableSenderOf([m({ convSeq: 1 }), m({ convSeq: 2, from: uid })], uid)).toBeNull();
    expect(reportableSenderOf([m({ convSeq: 1, from: uid })], uid)).toBeNull();
  });

  it("跨发送者 → null（群里勾到第二个人就置灰）", () => {
    // 后端只按首条反查处置对象；混着两个人会让一键封号落到"第一条那个人"头上。
    expect(reportableSenderOf([m({ convSeq: 1, from: "u2" }), m({ convSeq: 2, from: "u3" })], uid)).toBeNull();
  });

  it("含未发出的本地件（convSeq<=0）→ null（服务端定位不到）", () => {
    expect(reportableSenderOf([m({ convSeq: 1 }), m({ convSeq: 0 })], uid)).toBeNull();
  });

  it("空选 → null", () => {
    expect(reportableSenderOf([], uid)).toBeNull();
  });

  it("from 为空 → null（不拿空 uid 去开工单）", () => {
    expect(reportableSenderOf([m({ convSeq: 1, from: "" })], uid)).toBeNull();
  });
});

describe("SELECT_MAX", () => {
  it("是 100，且与后端举报单上限一致", () => {
    expect(SELECT_MAX).toBe(100);
  });

  // 上限闸的**累计语义**：相册整组全选在 MessageList 里是一轮 N 次 toggleSelected，
  // 若按 state 判上限，同一次渲染内 N 次都看到同一个旧 size → 会超额。这里用与 App
  // 同款的 ref 推进方式复刻那段逻辑，锁住"一轮多次调用也不会超"。
  it("一轮多次勾选累计计数，绝不超额", () => {
    let cur = new Set<number>();
    let blocked = 0;
    const toggle = (seq: number) => {
      const next = new Set(cur);
      if (next.has(seq)) { next.delete(seq); cur = next; return; }
      if (next.size >= SELECT_MAX) { blocked++; return; }
      next.add(seq);
      cur = next;
    };
    // 先勾满 98 条，再一次性勾一个 10 张的相册组。
    for (let i = 1; i <= 98; i++) toggle(i);
    expect(cur.size).toBe(98);
    for (let i = 200; i < 210; i++) toggle(i);
    expect(cur.size).toBe(SELECT_MAX); // 只进去 2 条
    expect(blocked).toBe(8);
    // 取消勾选永远放行（满额时也能取消，否则用户就卡死了）。
    toggle(1);
    expect(cur.size).toBe(SELECT_MAX - 1);
  });
});
