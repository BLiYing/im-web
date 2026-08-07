import { describe, it, expect, beforeEach } from "vitest";
import {
  mediaCacheName, downloadedFilesKey, expiredKey,
  loadStrSet, saveStrSet,
  cachePutBlob, cacheMatchBlob, cacheClear,
} from "./mediaCache";

describe("mediaCache · 命名空间键", () => {
  it("按 uid 命名空间化，空 uid 回退 anon", () => {
    expect(mediaCacheName("1001")).toBe("im-media-1001");
    expect(mediaCacheName("")).toBe("im-media-anon");
    expect(downloadedFilesKey("1001")).toBe("im.dlfiles.1001");
    expect(expiredKey("1001")).toBe("im.expired.1001");
    // 不同 uid 的键互不相同（跨账号隔离）
    expect(expiredKey("1001")).not.toBe(expiredKey("1003"));
  });
});

describe("mediaCache · 持久字符串集合", () => {
  beforeEach(() => localStorage.clear());

  it("写入后可读回（round-trip）", () => {
    const k = expiredKey("1001");
    saveStrSet(k, new Set(["/uploads/a.jpg", "/uploads/b.mp4"]));
    const got = loadStrSet(k);
    expect(got.has("/uploads/a.jpg")).toBe(true);
    expect(got.has("/uploads/b.mp4")).toBe(true);
    expect(got.size).toBe(2);
  });

  it("缺失键回退空集，不抛", () => {
    expect(loadStrSet("im.expired.nope").size).toBe(0);
  });

  it("损坏 JSON 回退空集，不抛", () => {
    const k = expiredKey("1001");
    localStorage.setItem(k, "{ not json");
    expect(loadStrSet(k).size).toBe(0);
  });

  it("末 500 条封顶，防无限增长", () => {
    const k = downloadedFilesKey("1001");
    const big = new Set<string>();
    for (let i = 0; i < 600; i++) big.add(`/uploads/f${i}`);
    saveStrSet(k, big);
    const got = loadStrSet(k);
    expect(got.size).toBe(500);
    // 保留的是"末 500"：最早的被丢，最后的在
    expect(got.has("/uploads/f0")).toBe(false);
    expect(got.has("/uploads/f599")).toBe(true);
  });
});

describe("mediaCache · Cache Storage 不可用时静默降级（Node/隐私模式）", () => {
  it("无 caches 全局时各操作不抛、返回空", async () => {
    expect(typeof (globalThis as unknown as { caches?: unknown }).caches).toBe("undefined");
    await expect(cachePutBlob("1001", "/uploads/a", new Blob(["x"]))).resolves.toBeUndefined();
    await expect(cacheMatchBlob("1001", "/uploads/a")).resolves.toBeNull();
    await expect(cacheClear("1001")).resolves.toBeUndefined();
  });
});
