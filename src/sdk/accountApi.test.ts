import { afterEach, describe, expect, it, vi } from "vitest";
import { CODE_ACCOUNT_PENDING_DELETION, deleteAccount, deleteAtMs, restoreAccount, type AccountError } from "./accountApi";
import { acquireToken, isDeadCredential, type TokenCredentials } from "./tokenSession";

const env = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("accountApi", () => {
  it("delete：POST 带 Bearer 与 password；成功 resolve", async () => {
    const f = vi.fn(async () => env({ code: 0 }));
    vi.stubGlobal("fetch", f);
    await deleteAccount("tok", "pw1");
    const [path, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/v1/account/delete");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ password: "pw1" });
  });
  it("delete：群主阻断 → 抛带 ownedGroups 的错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => env({ code: 100103, message: "x", data: { owned_groups: [{ conv_id: "g1", name: "产品组" }, { nope: 1 }] } })));
    const e = await deleteAccount("tok", "pw").then(() => null, (x) => x as AccountError);
    if (!e) throw new Error("should reject");
    expect(e.code).toBe(100103);
    expect(e.ownedGroups).toEqual([{ conv_id: "g1", name: "产品组" }]);
  });
  it("restore：免鉴权，body 为 username+password", async () => {
    const f = vi.fn(async () => env({ code: 0 }));
    vi.stubGlobal("fetch", f);
    await restoreAccount("limo", "pw");
    const [path, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/v1/account/restore");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(JSON.parse(init.body as string)).toEqual({ username: "limo", password: "pw" });
  });
  it("delete_at 秒/毫秒归一", () => {
    expect(deleteAtMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(deleteAtMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });
  it("登录遇冷静期账号：错误带 code+deleteAt，且被判为死凭据（不触发重连）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => env({ code: CODE_ACCOUNT_PENDING_DELETION, message: "pending", data: { delete_at: 1_700_000_000 } })));
    const c: TokenCredentials = { token: "", refreshToken: "", username: "limo", password: "pw", qrSession: false, device: { deviceId: "d", deviceName: "n" } };
    const e = await acquireToken(c, "").then(() => null, (x) => x as AccountError);
    if (!e) throw new Error("should reject");
    expect(e.code).toBe(CODE_ACCOUNT_PENDING_DELETION);
    expect(e.deleteAt).toBe(1_700_000_000);
    expect(isDeadCredential(CODE_ACCOUNT_PENDING_DELETION)).toBe(true);
  });
});
