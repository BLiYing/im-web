import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJoinRequests, inviteToGroup } from "./groupApi";

afterEach(() => { vi.unstubAllGlobals(); });
const stub = (data: unknown) => vi.stubGlobal("fetch", vi.fn(async () =>
  new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { "Content-Type": "application/json" } })));

describe("inviteToGroup", () => {
  it("解析 added 与 pending；缺字段当空", async () => {
    stub({ added: ["u1"], pending: ["u2"] });
    expect(await inviteToGroup("jwt", "g1", ["u1", "u2"])).toEqual({ added: ["u1"], pending: ["u2"] });
    stub({});
    expect(await inviteToGroup("jwt", "g1", ["u1"])).toEqual({ added: [], pending: [] });
  });
});

describe("fetchJoinRequests", () => {
  it("inviter_nickname 映射为 inviterNickname，空串不映射", async () => {
    stub({ requests: [
      { user_id: "a", nickname: "A", avatar_url: "", hello: "hi", status: "pending", created_at: 1, inviter_nickname: "张三" },
      { user_id: "b", nickname: "B", avatar_url: "", hello: "yo", status: "pending", created_at: 2 },
    ] });
    const r = await fetchJoinRequests("jwt", "g1");
    expect(r[0].inviterNickname).toBe("张三");
    expect(r[1].inviterNickname).toBeUndefined();
  });
});
