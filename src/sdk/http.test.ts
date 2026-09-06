import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDiagnosticLogs, diagnosticEntries, setLogLevel } from "../logging/logger";
import { callJson, setTokenRescue, tracedFetch } from "./http";

describe("HTTP 请求追踪", () => {
  beforeEach(() => {
    clearDiagnosticLogs();
    setLogLevel("debug");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("注入 X-Request-ID，并用同一 ID 关联脱敏后的请求响应", async () => {
    let receivedID = "";
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      receivedID = new Headers(init?.headers).get("X-Request-ID") || "";
      return new Response(JSON.stringify({ code: 0, data: { token: "jwt" } }), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-ID": receivedID },
      });
    }));

    await tracedFetch("/api/v1/login?debug=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "a1002", password: "pw" }),
    });

    expect(receivedID).toMatch(/^[0-9a-f-]{36}$/i);
    const [request, response] = diagnosticEntries();
    expect(request.fields).toMatchObject({ req: receivedID, method: "POST", path: "/api/v1/login" });
    expect(request.fields?.body).toBe('{"username":"a1002","password":"***"}');
    expect(response.fields).toMatchObject({ req: receivedID, status: 200 });
    expect(response.fields?.body).toBe('{"code":0,"data":{"token":"***"}}');
  });

  it("传输失败记录相同的请求 ID 且不吞掉原错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(tracedFetch("/api/v1/conversations")).rejects.toThrow("offline");
    const entries = diagnosticEntries();
    expect(entries.map((entry) => entry.event)).toEqual(["request", "transport_error"]);
    expect(entries[0].fields?.req).toBe(entries[1].fields?.req);
  });
});

// token 过期救援（2026-09-06）：页面挂过 24h 后所有 REST 都会撞 100102，而在此之前
// 没有任何代码去换 token——WS 长连接不复查、服务端只在握手校验，症状就是一堆零散的
// 「登录已失效」，要等 WS 真断一次重连才自愈。现在拦在这一层统一救。
describe("callJson 撞 100102 自动续期重试", () => {
  beforeEach(() => {
    clearDiagnosticLogs();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => { setTokenRescue(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  /** 首发 100102、其后按新 token 放行的假后端。 */
  function stubExpiringBackend(freshToken: string) {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("Authorization") || "";
      seen.push(auth);
      const ok = auth === `Bearer ${freshToken}`;
      return new Response(JSON.stringify(ok ? { code: 0, data: { ok: true } } : { code: 100102 }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    return seen;
  }

  it("续期成功 → 换上新 token 重试一次，调用方拿到正常结果（不该看见这次失效）", async () => {
    const seen = stubExpiringBackend("T2");
    setTokenRescue(async () => "T2");
    const data = await callJson("/api/v1/conversations", { headers: { Authorization: "Bearer T1" } });
    expect(data).toEqual({ ok: true });
    expect(seen).toEqual(["Bearer T1", "Bearer T2"]); // 恰好两发，第二发带新 token
  });

  it("救不了（无续期凭据）→ 原样把 100102 抛给调用方，不重试", async () => {
    const seen = stubExpiringBackend("T2");
    setTokenRescue(async () => "");
    await expect(callJson("/api/v1/conversations", { headers: { Authorization: "Bearer T1" } }))
      .rejects.toMatchObject({ code: 100102 });
    expect(seen).toHaveLength(1);
  });

  it("重试后仍 100102 → 抛出，不无限转圈", async () => {
    const seen = stubExpiringBackend("T-never");
    setTokenRescue(async () => "T2");
    await expect(callJson("/api/v1/conversations", { headers: { Authorization: "Bearer T1" } }))
      .rejects.toMatchObject({ code: 100102 });
    expect(seen).toHaveLength(2);
  });

  it("没装钩子（已退出登录）→ 不救", async () => {
    const seen = stubExpiringBackend("T2");
    await expect(callJson("/api/v1/conversations", { headers: { Authorization: "Bearer T1" } }))
      .rejects.toMatchObject({ code: 100102 });
    expect(seen).toHaveLength(1);
  });

  it("body 不可重放（FormData）→ 不重试，宁可抛错也别发半个请求", async () => {
    const seen = stubExpiringBackend("T2");
    setTokenRescue(async () => "T2");
    const form = new FormData();
    form.append("k", "v");
    await expect(callJson("/api/v1/upload", { method: "POST", body: form, headers: { Authorization: "Bearer T1" } }))
      .rejects.toMatchObject({ code: 100102 });
    expect(seen).toHaveLength(1);
  });

  it("非 100102 的业务错误不触发续期（如 300201 群不存在）", async () => {
    const rescue = vi.fn(async () => "T2");
    setTokenRescue(rescue);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 300201 }),
      { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(callJson("/api/v1/groups/x", { headers: { Authorization: "Bearer T1" } }))
      .rejects.toMatchObject({ code: 300201 });
    expect(rescue).not.toHaveBeenCalled();
  });
});

describe("callJson 救援的边界：免鉴权请求不碰", () => {
  beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "warn").mockImplementation(() => undefined); });
  afterEach(() => { setTokenRescue(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("原请求没有 Authorization → 不救（别给免鉴权接口偷偷补一个 Bearer 头）", async () => {
    const rescue = vi.fn(async () => "T2");
    setTokenRescue(rescue);
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("Authorization") || "");
      return new Response(JSON.stringify({ code: 100102 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    await expect(callJson("/api/v1/qr/login/poll")).rejects.toMatchObject({ code: 100102 });
    expect(rescue).not.toHaveBeenCalled();
    expect(seen).toEqual([""]);
  });
});
