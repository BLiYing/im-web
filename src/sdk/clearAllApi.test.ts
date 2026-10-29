import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllConversations, parseClearAll } from "./clearAllApi";

afterEach(() => vi.unstubAllGlobals());
const env = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("parseClearAll", () => {
  it("取 cleared 与 items[].conv_id/cleared_at；丢掉缺 conv_id 的脏项", () => {
    expect(parseClearAll({ cleared: 2, items: [{ conv_id: "a", cleared_at: 7 }, { cleared_at: 1 }, { conv_id: "b", cleared_at: 9 }] }))
      .toEqual({ cleared: 2, items: [{ convId: "a", clearedAt: 7 }, { convId: "b", clearedAt: 9 }] });
  });
  it("cleared 缺失退回 items 条数；整体非对象 → 空结果", () => {
    expect(parseClearAll({ items: [{ conv_id: "a", cleared_at: 3 }] }).cleared).toBe(1);
    expect(parseClearAll(null)).toEqual({ cleared: 0, items: [] });
  });
});

describe("clearAllConversations", () => {
  it("POST 无 body + Bearer；成功返回解析结果", async () => {
    const f = vi.fn(async () => env({ code: 0, data: { cleared: 1, items: [{ conv_id: "a", cleared_at: 4 }] } }));
    vi.stubGlobal("fetch", f);
    const r = await clearAllConversations("tok");
    expect(r).toEqual({ cleared: 1, items: [{ convId: "a", clearedAt: 4 }] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/users/me/conversations/clear");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
  });
  it("限流 100002 → 抛带 code 的本地化错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => env({ code: 100002, message: "rate limited" })));
    await expect(clearAllConversations("tok")).rejects.toMatchObject({ code: 100002, message: "操作过于频繁，请稍后再试" });
  });
});
