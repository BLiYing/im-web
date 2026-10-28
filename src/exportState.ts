// 「导出我的数据」页的纯逻辑：任务对象 → 4 态映射、冷却小时数、按钮可用性（设计 DATA_EXPORT_DESIGN §1）。
import type { ExportJob } from "./sdk/exportApi";

/** 成功后 24 小时内不可再发起。 */
export const EXPORT_COOLDOWN_MS = 24 * 3600 * 1000;

export type ExportView =
  | { kind: "config"; expiredNote?: boolean }
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "failed" }
  | { kind: "cooldown"; hours: number };

/** 剩余秒数 → 展示小时数：向上取整，最少 1（避免「0 小时后可再次导出」）。 */
export function cooldownHours(sec: number): number {
  return Math.max(1, Math.ceil(sec / 3600));
}

/** queued / running 才需要轮询。 */
export function isActive(job: ExportJob | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}

/** 任务对象 + 当前时刻 + 本地冷却截止（200011 回包得来，0=无）→ 页面状态。 */
export function exportView(job: ExportJob | null, now: number, localCooldownUntil: number): ExportView {
  if (isActive(job)) return { kind: "running" };
  if (job?.status === "done" && (job.expiresAt === 0 || job.expiresAt > now)) return { kind: "done" };
  if (job?.status === "failed") return { kind: "failed" };
  // 成功过（done 但文件已过期 / expired）：24h 冷却从 finished_at 起算。
  let until = localCooldownUntil > now ? localCooldownUntil : 0;
  const succeeded = job?.status === "done" || job?.status === "expired";
  if (succeeded && job.finishedAt > 0) until = Math.max(until, job.finishedAt + EXPORT_COOLDOWN_MS);
  if (until > now) return { kind: "cooldown", hours: cooldownHours(Math.ceil((until - now) / 1000)) };
  return job?.status === "expired" ? { kind: "config", expiredNote: true } : { kind: "config" };
}

export function exportFormats(html: boolean, json: boolean): string[] {
  return [...(html ? ["html"] : []), ...(json ? ["json"] : [])];
}

/** 「开始导出」可用：密码非空、至少一种格式、不在提交中、不在冷却。 */
export function canStartExport(s: { password: string; html: boolean; json: boolean; busy: boolean; cooling: boolean }): boolean {
  return s.password.length > 0 && (s.html || s.json) && !s.busy && !s.cooling;
}

/** 视图下一次「仅因时间流逝」而变化的时刻（毫秒；0=不会变）：done 到 expires_at、本地 / finished_at+24h 冷却结束。
 *  渲染时的 now 比较不会自己触发重渲染，调用方据此设一个定时器。 */
export function nextViewChangeAt(job: ExportJob | null, now: number, localCooldownUntil: number): number {
  const c: number[] = [];
  if (job?.status === "done" && job.expiresAt > now) c.push(job.expiresAt);
  if (localCooldownUntil > now) c.push(localCooldownUntil);
  const succeeded = job?.status === "done" || job?.status === "expired";
  if (succeeded && job.finishedAt > 0 && job.finishedAt + EXPORT_COOLDOWN_MS > now) c.push(job.finishedAt + EXPORT_COOLDOWN_MS);
  return c.length ? Math.min(...c) : 0;
}
