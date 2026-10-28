import { describe, expect, it } from "vitest";
import { nextViewChangeAt, canStartExport, cooldownHours, exportFormats, exportView, isActive, EXPORT_COOLDOWN_MS } from "./exportState";
import type { ExportJob } from "./sdk/exportApi";

const NOW = 2_000_000_000_000;
const job = (o: Partial<ExportJob> = {}): ExportJob => ({
  id: "e1", status: "running", includeMedia: false, formats: ["html"], doneConvs: 0, totalConvs: 0,
  result: null, createdAt: NOW - 1000, finishedAt: 0, expiresAt: 0, errorCode: "", ...o,
});

describe("exportView 状态机映射", () => {
  it("无任务 / 已取消 → 配置态", () => {
    expect(exportView(null, NOW, 0).kind).toBe("config");
    expect(exportView(job({ status: "canceled" }), NOW, 0).kind).toBe("config");
  });
  it("queued / running → 进行中", () => {
    expect(exportView(job({ status: "queued" }), NOW, 0).kind).toBe("running");
    expect(exportView(job({ status: "running" }), NOW, 0).kind).toBe("running");
  });
  it("done 未过期 → 完成；done 但 expires_at 已过 → 不再给下载", () => {
    expect(exportView(job({ status: "done", finishedAt: NOW - 5, expiresAt: NOW + 1000 }), NOW, 0).kind).toBe("done");
    expect(exportView(job({ status: "done", finishedAt: NOW - 5, expiresAt: NOW - 1 }), NOW, 0).kind).toBe("cooldown");
  });
  it("failed → 失败态", () => {
    expect(exportView(job({ status: "failed" }), NOW, 0).kind).toBe("failed");
  });
  it("expired：仍在 24h 冷却内 → 冷却；冷却已过 → 配置态并带过期说明", () => {
    const v1 = exportView(job({ status: "expired", finishedAt: NOW - 3600_000 }), NOW, 0);
    expect(v1).toMatchObject({ kind: "cooldown", hours: 23 });
    const v2 = exportView(job({ status: "expired", finishedAt: NOW - EXPORT_COOLDOWN_MS - 1 }), NOW, 0);
    expect(v2).toMatchObject({ kind: "config", expiredNote: true });
  });
  it("本地冷却（200011 回包）优先于配置态，向上取整小时", () => {
    expect(exportView(null, NOW, NOW + 3601_000)).toMatchObject({ kind: "cooldown", hours: 2 });
    expect(exportView(null, NOW, NOW - 1).kind).toBe("config"); // 已过期的冷却不再生效
  });
  it("进行中任务不被本地冷却盖掉", () => {
    expect(exportView(job({ status: "running" }), NOW, NOW + 1000).kind).toBe("running");
  });
});

describe("cooldownHours 向上取整", () => {
  it.each([[1, 1], [3600, 1], [3601, 2], [7200, 2], [86400, 24], [0, 1]])("%i 秒 → %i 小时", (s, h) => {
    expect(cooldownHours(s)).toBe(h);
  });
});

describe("canStartExport 按钮可用性", () => {
  const ok = { password: "pw", html: true, json: false, busy: false, cooling: false };
  it("满足条件可用", () => expect(canStartExport(ok)).toBe(true));
  it("密码空 / 两格式都未勾 / 提交中 / 冷却中 均不可用", () => {
    expect(canStartExport({ ...ok, password: "" })).toBe(false);
    expect(canStartExport({ ...ok, html: false })).toBe(false);
    expect(canStartExport({ ...ok, busy: true })).toBe(false);
    expect(canStartExport({ ...ok, cooling: true })).toBe(false);
  });
});

describe("exportFormats / isActive", () => {
  it("按固定顺序输出", () => {
    expect(exportFormats(true, true)).toEqual(["html", "json"]);
    expect(exportFormats(false, true)).toEqual(["json"]);
  });
  it("仅 queued/running 需要轮询", () => {
    expect(isActive(job({ status: "queued" }))).toBe(true);
    expect(isActive(job({ status: "done" }))).toBe(false);
    expect(isActive(null)).toBe(false);
  });
});

describe("nextViewChangeAt 视图下一次因时间而变的时刻", () => {
  it("done 未过期 → expires_at；已过期 / 非 done → 看冷却截止", () => {
    expect(nextViewChangeAt(job({ status: "done", finishedAt: NOW - 5, expiresAt: NOW + 1000 }), NOW, 0)).toBe(NOW + 1000);
    expect(nextViewChangeAt(null, NOW, 0)).toBe(0);
    expect(nextViewChangeAt(job({ status: "running" }), NOW, 0)).toBe(0);
  });
  it("本地冷却截止在未来 → 取它；与 expires_at 取较早者", () => {
    expect(nextViewChangeAt(null, NOW, NOW + 500)).toBe(NOW + 500);
    expect(nextViewChangeAt(job({ status: "done", finishedAt: NOW - 5, expiresAt: NOW + 1000 }), NOW, NOW + 500)).toBe(NOW + 500);
  });
  it("expired 且仍在 24h 冷却内 → finished_at + 24h", () => {
    expect(nextViewChangeAt(job({ status: "expired", finishedAt: NOW - 1000 }), NOW, 0)).toBe(NOW - 1000 + EXPORT_COOLDOWN_MS);
  });
});
