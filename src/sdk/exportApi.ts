// 「导出我的数据」REST 契约（设计 IMServer/docs/design/DATA_EXPORT_DESIGN.md §2）：
//   POST /api/v1/users/me/exports                    {password, include_media, formats} → 任务对象
//   GET  /api/v1/users/me/exports/latest             → 任务对象 | null
//   POST /api/v1/users/me/exports/{id}/cancel        幂等
//   POST /api/v1/users/me/exports/{id}/download_url  → {url(相对路径), expires_in}
// 错误：200002 密码错 / 200010 ExportBusy / 200011 ExportCooldown（回包 data.retry_after_sec）。
// 无状态一次性请求，不碰 socket / 本地库；下载链接本身不带登录头（token 在 query 里）。
import { callJson, fetchEnvelope } from "./http";
import { friendlyMessage } from "./errcode";

export const CODE_WRONG_PASSWORD = 200002;
export const CODE_EXPORT_BUSY = 200010;
export const CODE_EXPORT_COOLDOWN = 200011;

export type ExportStatus = "queued" | "running" | "done" | "failed" | "canceled" | "expired";
const STATUSES: readonly ExportStatus[] = ["queued", "running", "done", "failed", "canceled", "expired"];

export interface ExportResult { sizeBytes: number; convCount: number; msgCount: number }
export interface ExportJob {
  id: string;
  status: ExportStatus;
  includeMedia: boolean;
  formats: string[];
  doneConvs: number;
  totalConvs: number;
  result: ExportResult | null;
  createdAt: number; // 毫秒；0=缺
  finishedAt: number;
  expiresAt: number;
  errorCode: string; // 服务端字符串枚举 "interrupted" | "internal"；无=""。UI 只区分失败，不按值分文案
}

export type ExportError = Error & { code?: number; retryAfterSec?: number };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** 时间戳归一为毫秒：<1e12 视为秒。 */
const ms = (v: unknown): number => { const n = num(v); return n > 0 && n < 1e12 ? n * 1000 : n; };

/** 任务对象解析（脏数据安全）：缺 id → null；未知 status 兜底 failed，避免界面永远卡在「进行中」。 */
export function parseExportJob(raw: unknown): ExportJob | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const prog = (r.progress ?? {}) as Record<string, unknown>;
  const res = r.result && typeof r.result === "object" ? (r.result as Record<string, unknown>) : null;
  return {
    id: r.id,
    status: STATUSES.includes(r.status as ExportStatus) ? (r.status as ExportStatus) : "failed",
    includeMedia: r.include_media === true,
    formats: Array.isArray(r.formats) ? r.formats.filter((f): f is string => typeof f === "string") : [],
    doneConvs: num(prog.done_convs),
    totalConvs: num(prog.total_convs),
    result: res ? { sizeBytes: num(res.size_bytes), convCount: num(res.conv_count), msgCount: num(res.msg_count) } : null,
    createdAt: ms(r.created_at),
    finishedAt: ms(r.finished_at),
    expiresAt: ms(r.expires_at),
    errorCode: typeof r.error_code === "string" ? r.error_code : "",
  };
}

const BASE = "/api/v1/users/me/exports";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const json = (token: string) => ({ ...auth(token), "Content-Type": "application/json" });

export async function getLatestExport(token: string): Promise<ExportJob | null> {
  return parseExportJob(await callJson(`${BASE}/latest`, { headers: auth(token) }));
}

export async function startExport(token: string, p: { password: string; includeMedia: boolean; formats: string[] }): Promise<ExportJob> {
  // 不走 callJson：冷却错误要读 data.retry_after_sec。
  const res = await fetchEnvelope<{ retry_after_sec?: unknown }>(BASE, {
    method: "POST", headers: json(token),
    body: JSON.stringify({ password: p.password, include_media: p.includeMedia, formats: p.formats }),
  });
  if (res.code !== 0) {
    const err = new Error(friendlyMessage(res.code, res.message ?? "")) as ExportError;
    err.code = res.code;
    const sec = (res.data as { retry_after_sec?: unknown } | undefined)?.retry_after_sec;
    if (typeof sec === "number" && sec > 0) err.retryAfterSec = sec;
    throw err;
  }
  const job = parseExportJob(res.data);
  if (!job) throw new Error("export: invalid job payload");
  return job;
}

export async function cancelExport(token: string, id: string): Promise<void> {
  await callJson(`${BASE}/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: auth(token) });
}

/** 取一次性下载链接（相对路径）；字段缺失抛错。 */
export async function getExportDownloadUrl(token: string, id: string): Promise<string> {
  const data = (await callJson(`${BASE}/${encodeURIComponent(id)}/download_url`, { method: "POST", headers: auth(token) })) as { url?: unknown } | null;
  if (!data || typeof data.url !== "string" || !data.url) throw new Error("export: download_url missing");
  return data.url;
}

/** 客户端自拼基址：绝对地址原样；相对路径 = base + url（Web 同源 base 为空）。 */
export function resolveDownloadUrl(url: string, base = ""): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${base.replace(/\/+$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}
