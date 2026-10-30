import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireToken, type TokenCredentials } from "./tokenSession";

const base: TokenCredentials = {
  token: "", refreshToken: "", username: "twostep03", password: "pw", qrSession: false,
  device: { deviceId: "web-dev-1", deviceName: "Chrome · macOS" },
};
const res = (body: unknown) => new Response(JSON.stringify(body), { status: 400, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("acquireToken · 两步验证", () => {
  it("/login 回 200020：抛带 code 与 data.ticket 的错误（HTTP 400 + 信封）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({ code: 200020, message: "two-step required", data: { ticket: "TK", methods: ["totp", "recovery"], expires_in: 300 } })));
    const e = await acquireToken(base, "").catch((err) => err);
    expect(e.code).toBe(200020);
    expect(e.data.ticket).toBe("TK");
  });
  it("带 twoStep：只打 /login/two-step（不探活、不续期、不打 /login），体里只有 ticket+code", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { token: "T", uid: "u9", refresh_token: "R" } }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const got = await acquireToken({ ...base, token: "OLD", refreshToken: "RR", twoStep: { ticket: "TK", code: "123456" } }, "");
    expect(got).toEqual({ token: "T", uid: "u9", refreshToken: "R" });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/login/two-step");
    expect(JSON.parse(String(init.body))).toEqual({ ticket: "TK", code: "123456" });
  });
  it("第二步失败保留 attempts_left", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({ code: 200021, message: "bad", data: { attempts_left: 2 } })));
    const e = await acquireToken({ ...base, twoStep: { ticket: "TK", code: "000000" } }, "").catch((err) => err);
    expect(e).toMatchObject({ code: 200021, data: { attempts_left: 2 } });
  });
});
