// 隐私设置 HTTP 封装：PUT 只带被改的一项（部分更新，别覆盖 auto_delete_default_sec）；档位解析容错。
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPrivacy, parseVisibility, patchBody, putAutoDeleteDefault, putPrivacy } from "./privacyApi";

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(data: unknown, bodies: unknown[] = []) {
  vi.stubGlobal("fetch", vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
}

describe("档位解析", () => {
  it("三值原样，脏值 / 空串 / 非字符串落 fallback", () => {
    expect(parseVisibility("nobody", "everyone")).toBe("nobody");
    expect(parseVisibility("", "contacts")).toBe("contacts");
    expect(parseVisibility("friends", "everyone")).toBe("everyone");
    expect(parseVisibility(undefined, "contacts")).toBe("contacts");
    expect(parseVisibility(3, "contacts")).toBe("contacts");
  });
  it("GET：缺字段用默认（上次上线 contacts / 头像 everyone / 个人简介 everyone / 手机号码 nobody）", async () => {
    stubFetch({ auto_delete_default_sec: 86400 });
    expect(await getPrivacy("t")).toEqual({ autoDeleteSec: 86400, lastSeen: "contacts", avatar: "everyone", bio: "everyone", phone: "nobody" });
  });
  it("GET：读出服务端档位", async () => {
    stubFetch({ auto_delete_default_sec: 0, last_seen_visibility: "nobody", avatar_visibility: "contacts", bio_visibility: "nobody", phone_visibility: "everyone" });
    expect(await getPrivacy("t")).toEqual({ autoDeleteSec: 0, lastSeen: "nobody", avatar: "contacts", bio: "nobody", phone: "everyone" });
  });
});

describe("PUT 部分更新", () => {
  it("patchBody 只含给出的字段", () => {
    expect(patchBody({ lastSeen: "nobody" })).toEqual({ last_seen_visibility: "nobody" });
    expect(patchBody({ avatar: "contacts" })).toEqual({ avatar_visibility: "contacts" });
    expect(patchBody({ autoDeleteSec: 0 })).toEqual({ auto_delete_default_sec: 0 }); // 0 是合法档位，不能被当缺省丢掉
    expect(patchBody({ bio: "nobody" })).toEqual({ bio_visibility: "nobody" });
    expect(patchBody({ phone: "contacts" })).toEqual({ phone_visibility: "contacts" });
  });
  it("改上次上线：请求体不带 auto_delete_default_sec / avatar_visibility", async () => {
    const bodies: unknown[] = [];
    stubFetch({}, bodies);
    await putPrivacy("t", { lastSeen: "everyone" });
    expect(bodies).toEqual([{ last_seen_visibility: "everyone" }]);
  });
  it("改自动删除默认档位：只带该字段", async () => {
    const bodies: unknown[] = [];
    stubFetch({}, bodies);
    await putAutoDeleteDefault("t", 604800);
    expect(bodies).toEqual([{ auto_delete_default_sec: 604800 }]);
  });
});
