import { afterEach, describe, expect, it, vi } from "vitest";
import { callJson } from "./http";
import { loginTwoStep, parseChallenge, parseCodes, parseStatus } from "./twoStepApi";

const envelope = (body: unknown, status = 400) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("twoStepApi 解析", () => {
  it("状态：enabled_at 秒 / 毫秒都归一为毫秒；缺字段给 0", () => {
    expect(parseStatus({ enabled: true, enabled_at: 1_700_000_000, recovery_remaining: 8 })).toEqual({ enabled: true, enabledAt: 1_700_000_000_000, recoveryRemaining: 8 });
    expect(parseStatus({ enabled: true, enabled_at: 1_700_000_000_000 }).enabledAt).toBe(1_700_000_000_000);
    expect(parseStatus({ enabled: false })).toEqual({ enabled: false, enabledAt: 0, recoveryRemaining: 0 });
    expect(parseStatus(null).enabled).toBe(false);
  });
  it("恢复码：过滤脏项；空列表抛错（不能默默显示 0 个）", () => {
    expect(parseCodes({ recovery_codes: ["a", 1, "", "b"] })).toEqual(["a", "b"]);
    expect(() => parseCodes({})).toThrow();
  });
  it("200020 data：缺 ticket 视为无效", () => {
    expect(parseChallenge({ ticket: "T", methods: ["totp", 1], expires_in: 300 })).toEqual({ ticket: "T", methods: ["totp"], expiresIn: 300 });
    expect(parseChallenge({ methods: [] })).toBeNull();
  });
});

describe("错误保留 data（HTTP 400 + 标准信封）", () => {
  it("callJson：业务错误带 .code 与 .data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => envelope({ code: 200021, message: "bad", data: { attempts_left: 2 } })));
    const e = await callJson("/x").catch((err) => err);
    expect(e.code).toBe(200021);
    expect(e.data).toEqual({ attempts_left: 2 });
  });
  it("loginTwoStep：成功体含 refresh_token；失败保留 attempts_left", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ code: 0, data: { token: "tk", uid: "u1", refresh_token: "rt" } }, 200))
      .mockResolvedValueOnce(envelope({ code: 200021, message: "bad", data: { attempts_left: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loginTwoStep({ ticket: "T", code: "123456" })).toEqual({ token: "tk", uid: "u1", refreshToken: "rt" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ticket: "T", code: "123456" });
    const e = await loginTwoStep({ ticket: "T", code: "000000" }).catch((err) => err);
    expect(e.code).toBe(200021);
    expect(e.data).toEqual({ attempts_left: 1 });
  });
});
