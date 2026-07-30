import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDiagnosticLogs, diagnosticEntries, setLogLevel } from "../logging/logger";
import { tracedFetch } from "./http";

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
