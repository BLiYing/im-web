import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireToken, createRenewer, isDeadCredential, renewWithRefresh, type TokenCredentials } from "./tokenSession";

/** 造一个信封响应。 */
function envelope(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** 记录每次请求的路径与 body，按路径给出预置响应。 */
function stubFetch(routes: Record<string, unknown | unknown[]>) {
  const calls: { path: string; body: any; auth: string }[] = [];
  const queues = new Map<string, unknown[]>(
    Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]),
  );
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0];
    const raw = init?.body;
    calls.push({
      path,
      body: typeof raw === "string" ? JSON.parse(raw) : undefined,
      auth: new Headers(init?.headers).get("Authorization") || "",
    });
    const q = queues.get(path);
    if (!q || q.length === 0) throw new Error(`unexpected request: ${path}`);
    return envelope(q.length > 1 ? q.shift() : q[0]);
  }));
  return calls;
}

const base: TokenCredentials = {
  token: "", refreshToken: "", username: "a1002", password: "", qrSession: false,
  device: { deviceId: "web-dev-1", deviceName: "Chrome · macOS" },
};

describe("acquireToken 择路", () => {
  beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "warn").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("手上 token 仍有效 → 探活复用，不打 /login 也不续期", async () => {
    const calls = stubFetch({ "/api/v1/devices": { code: 0, data: {} } });
    const got = await acquireToken({ ...base, token: "T1" }, "1001");
    expect(got).toEqual({ token: "T1", uid: "1001" });
    expect(calls.map((c) => c.path)).toEqual(["/api/v1/devices"]);
  });

  it("探活得 100101（会话被吊销）→ 抛，绝不用密码重登把「被踢」洗掉", async () => {
    stubFetch({ "/api/v1/devices": { code: 100101, message: "revoked" }, "/api/v1/login": { code: 0, data: { token: "NEW" } } });
    await expect(acquireToken({ ...base, token: "T1", password: "pw" }, "1001"))
      .rejects.toMatchObject({ code: 100101 });
  });

  it("token 过期 + 有续期凭据 → 走 /token/refresh，不碰密码", async () => {
    const calls = stubFetch({
      "/api/v1/devices": { code: 100102 },
      "/api/v1/token/refresh": { code: 0, data: { token: "T2", uid: "1001" } },
    });
    const got = await acquireToken({ ...base, token: "T1", refreshToken: "R1", password: "pw" }, "1001");
    expect(got).toEqual({ token: "T2", uid: "1001" });
    expect(calls.map((c) => c.path)).toEqual(["/api/v1/devices", "/api/v1/token/refresh"]);
    expect(calls[1].body).toEqual({ refresh_token: "R1" });
  });

  it("续期凭据被拒 → 抛，不退回密码登录（服务端认定这条会话已死）", async () => {
    stubFetch({
      "/api/v1/token/refresh": { code: 100101, message: "invalid" },
      "/api/v1/login": { code: 0, data: { token: "NEW", uid: "1001" } },
    });
    await expect(acquireToken({ ...base, refreshToken: "R-dead", password: "pw" }, "1001"))
      .rejects.toMatchObject({ code: 100101 });
  });

  it("无 token 无续期凭据 → /login，并收下随之下发的续期凭据", async () => {
    const calls = stubFetch({ "/api/v1/login": { code: 0, data: { token: "T1", uid: "1001", refresh_token: "R1" } } });
    const got = await acquireToken({ ...base, password: "pw" }, "");
    expect(got).toEqual({ token: "T1", uid: "1001", refreshToken: "R1" });
    expect(calls[0].body).toMatchObject({ username: "a1002", password: "pw", platform: "web", device_id: "web-dev-1" });
  });

  it("扫码会话（无密码）token 失效且无续期凭据 → 直接回登录，不打 /login", async () => {
    const calls = stubFetch({ "/api/v1/devices": { code: 100102 } });
    await expect(acquireToken({ ...base, token: "T1", username: "", qrSession: true }, "1001"))
      .rejects.toMatchObject({ code: 100102 });
    expect(calls.map((c) => c.path)).toEqual(["/api/v1/devices"]);
  });
});

describe("renewWithRefresh", () => {
  beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "warn").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("成功回 token+uid", async () => {
    stubFetch({ "/api/v1/token/refresh": { code: 0, data: { token: "T2", uid: "1001" } } });
    await expect(renewWithRefresh("R1")).resolves.toEqual({ token: "T2", uid: "1001" });
  });

  it("失败抛带业务码的 Error", async () => {
    stubFetch({ "/api/v1/token/refresh": { code: 100102, message: "refresh token expired" } });
    await expect(renewWithRefresh("R1")).rejects.toMatchObject({ code: 100102 });
  });
});

describe("createRenewer 单飞", () => {
  it("并发调用只打一次续期请求，且各自拿到同一枚新 token", async () => {
    let calls = 0;
    let release: (v: { token: string; uid: string }) => void = () => {};
    const renew = vi.fn(async () => { calls++; return new Promise<{ token: string; uid: string }>((r) => { release = r; }); });
    const renewed: string[] = [];
    const renewer = createRenewer({
      getRefreshToken: () => "R1", onRenewed: (t) => renewed.push(t), onDead: () => {}, renew,
    });
    const all = Promise.all([renewer(), renewer(), renewer()]);
    release({ token: "T2", uid: "1001" });
    expect(await all).toEqual(["T2", "T2", "T2"]);
    expect(calls).toBe(1);
    expect(renewed).toEqual(["T2"]); // 只应用一次
  });

  it("在途结束后可以再续一次（不是只准一次）", async () => {
    const renew = vi.fn(async () => ({ token: "T2", uid: "1001" }));
    const renewer = createRenewer({ getRefreshToken: () => "R1", onRenewed: () => {}, onDead: () => {}, renew });
    await renewer();
    await renewer();
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it("没有续期凭据 → 直接回空串，不发请求", async () => {
    const renew = vi.fn();
    const renewer = createRenewer({ getRefreshToken: () => "", onRenewed: () => {}, onDead: () => {}, renew: renew as never });
    expect(await renewer()).toBe("");
    expect(renew).not.toHaveBeenCalled();
  });

  it("凭据已死 → 回空串并触发 onDead（上层据此擦凭据 + 回登录页）", async () => {
    const err = Object.assign(new Error("登录已失效"), { code: 100101 });
    const renewer = createRenewer({
      getRefreshToken: () => "R-dead", onRenewed: () => {}, onDead: (code) => { dead = code; },
      renew: vi.fn(async () => { throw err; }),
    });
    let dead = 0;
    expect(await renewer()).toBe("");
    expect(dead).toBe(100101);
  });

  it("网络类失败 → 回空串但不触发 onDead（凭据没死，别把用户踢回登录页）", async () => {
    let dead = 0;
    const renewer = createRenewer({
      getRefreshToken: () => "R1", onRenewed: () => {}, onDead: (c) => { dead = c; },
      renew: vi.fn(async () => { throw new Error("无法连接服务器"); }),
    });
    expect(await renewer()).toBe("");
    expect(dead).toBe(0);
  });
});

describe("isDeadCredential", () => {
  it("覆盖鉴权失败类码，不含网络/限流", () => {
    [100101, 100102, 200001, 200002, 200003].forEach((c) => expect(isDeadCredential(c)).toBe(true));
    [0, 100002, 100003, 300201, undefined].forEach((c) => expect(isDeadCredential(c)).toBe(false));
  });
});
