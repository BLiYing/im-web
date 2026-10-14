import { describe, it, expect, vi } from "vitest";
import { createExpiryProber, isProbeableUrl } from "./expiryProber";
import type { ChatMessage } from "./sdk/protocol";

const m = (content: string): ChatMessage => ({ convId: "c", convSeq: 1, contentType: "image", content, from: "u", timestamp: 1 } as ChatMessage);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("isProbeableUrl", () => {
  it("相对路径与 http(s) 可探；blob:/data:/协议相对/空不探", () => {
    expect(isProbeableUrl("/uploads/a.jpg")).toBe(true);
    expect(isProbeableUrl("https://x/a.jpg")).toBe(true);
    for (const u of ["", "blob:abc", "data:image/png;base64,xx", "//cdn/x.jpg", "im-pending://1"]) expect(isProbeableUrl(u)).toBe(false);
  });
});

describe("createExpiryProber", () => {
  it("404 回调 onGone；同址只探一次，force 再探", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 404 });
    const onGone = vi.fn();
    const probe = createExpiryProber({ fetchFn, isKnownExpired: () => false, onGone });
    probe(m("/uploads/a.jpg")); probe(m("/uploads/a.jpg"));
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(onGone).toHaveBeenCalledTimes(1);
    probe(m("/uploads/a.jpg"), true);
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("200 不标；5xx/断网撤记号后可再探", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ status: 503 }).mockRejectedValueOnce(new Error("net")).mockResolvedValue({ status: 200 });
    const onGone = vi.fn();
    const probe = createExpiryProber({ fetchFn, isKnownExpired: () => false, onGone });
    probe(m("/u/x.jpg")); await flush();
    probe(m("/u/x.jpg")); await flush();
    probe(m("/u/x.jpg")); await flush();
    probe(m("/u/x.jpg")); await flush(); // 200 已探过 → 不再发
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(onGone).not.toHaveBeenCalled();
  });

  it("已知失效 / 不可探地址不发请求；并发不超过上限", async () => {
    let live = 0, peak = 0;
    const fetchFn = vi.fn(async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return { status: 200 }; });
    const probe = createExpiryProber({ fetchFn, isKnownExpired: (k) => k === "/u/gone.jpg", onGone: vi.fn(), max: 2 });
    probe(m("/u/gone.jpg")); probe(m("blob:x"));
    for (let i = 0; i < 6; i++) probe(m(`/u/${i}.jpg`));
    await new Promise((r) => setTimeout(r, 60));
    expect(fetchFn).toHaveBeenCalledTimes(6);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
