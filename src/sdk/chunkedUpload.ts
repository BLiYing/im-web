/**
 * 分片上传（对齐 iOS IMChunkedUploader / PROTOCOL §5.1）：init → chunk* → complete，
 * status 问服务端 offset（唯一权威）续传。
 *
 * 与 iOS 相同的四条防线（真机踩坑清单的 Web 版）：
 *  1. **代际号单链化**：任一时刻只允许一条传输链在跑；暂停/恢复/重启都会 +1 换代，
 *     旧链的每个 await 续步发现换代立即退出——否则每暂停/恢复一轮泄漏一条并行链，挤爆带宽。
 *  2. **真正 abort 在飞请求**（AbortController）：换代只能作废回调，8MB 请求体仍会传完。
 *  3. **业务拒绝 ≠ 网络失败**：服务端明确拒绝（code>0，典型「上传会话不存在或已过期」）重试同一
 *     会话必然再失败 → 清掉死 upload_id 换新会话从头传（限 2 次）；网络失败 offset 还在服务端，
 *     2s 退避自动续 2 次，连续失败才交给用户手动重试。
 *  4. 终态（成功/失败/取消）后任何迟到回调作废（finished + 换代双保险）。
 *
 * 浏览器限制（对比 iOS 的已知差距）：File 句柄无法跨刷新持久化——页面刷新后进行中的上传作废，
 * 不能像 iOS 那样杀进程后凭旁挂 upload_id 自动续传。
 */
import { tracedFetch } from "./http";
import { friendlyMessage } from "./imSdk";
import { logger, LOG_TAG } from "../logging/logger";

/** 单片大小 = 服务端 init 响应建议值与其单片上限（8MB）。 */
export const CHUNK_SIZE = 8 * 1024 * 1024;
/** ≥ 该大小才走分片（小文件多 3 次往返反而更慢），与 iOS chunkedThresholdBytes 一致。 */
export const CHUNKED_THRESHOLD = 8 * 1024 * 1024;

/**
 * errcode.ParamInvalid（服务端 upload_chunked.go 对「上传会话不存在或已过期」/「非法 upload_id」/
 * 「offset 非法」都回这个码）。**只有它**值得清 upload_id 换新会话从 0 重传去自愈；其余业务码
 * （FileTooLarge / FileTypeInvalid / TokenExpired 等）是确定性拒绝，重试必再失败，应立即失败。
 */
const SESSION_LOST_CODE = 100001;

export interface ChunkedResult { url: string; contentType: string; size: number }

/** 用户主动取消：调用方据此静默移除气泡，而不是当失败报错。 */
export class UploadCancelledError extends Error {
  constructor() { super("已取消发送"); this.name = "UploadCancelledError"; }
}

/** 服务端业务拒绝（HTTP 层成功但 code≠0）——与网络失败分流的依据。 */
class BusinessError extends Error {
  constructor(readonly code: number, message: string) { super(message); this.name = "BusinessError"; }
}

const registry = new Map<string, ChunkedUploadTask>();

/** 进行中的分片任务（含暂停态）；无则 undefined。气泡的 ⏸/↑ 点击据此定位任务。 */
export function chunkedTaskFor(key: string): ChunkedUploadTask | undefined {
  return registry.get(key);
}

export class ChunkedUploadTask {
  readonly key: string;
  paused = false;
  onProgress?: (sent: number, total: number) => void;
  readonly promise: Promise<ChunkedResult>;

  private readonly file: File;
  private readonly token: string;
  private cancelled = false;
  private finished = false;
  private generation = 0;
  private restartCount = 0;
  private netRetryCount = 0;
  private uploadId: string | undefined;
  private inFlight: AbortController | null = null;
  private resolveFn!: (r: ChunkedResult) => void;
  private rejectFn!: (e: Error) => void;

  constructor(file: File, token: string, key: string, onProgress?: (sent: number, total: number) => void) {
    this.file = file;
    this.token = token;
    this.key = key;
    this.onProgress = onProgress;
    this.promise = new Promise<ChunkedResult>((resolve, reject) => { this.resolveFn = resolve; this.rejectFn = reject; });
    registry.set(key, this);
    void this.runChain(++this.generation);
  }

  pause(): void {
    if (this.cancelled || this.finished || this.paused) return;
    this.paused = true;
    this.inFlight?.abort(); // 真正掐断在飞请求；其回调经代际/暂停检查后被丢弃
    this.inFlight = null;
    // 日志字段用 client_msg_id（=this.key），与 IM.HTTP 上传请求对账（docs/LOGGING.md §3）。
    logger.info(LOG_TAG.media, "upload_paused", { client_msg_id: this.key, upload_id: this.uploadId ?? "-" });
  }

  resume(): void {
    if (this.cancelled || this.finished || !this.paused) return;
    this.paused = false;
    logger.info(LOG_TAG.media, "upload_resumed", { client_msg_id: this.key, upload_id: this.uploadId ?? "-" });
    void this.runChain(++this.generation); // 恢复以服务端 status 的 offset 为准续传
  }

  cancel(): void {
    if (this.finished || this.cancelled) return;
    this.cancelled = true;
    this.inFlight?.abort();
    this.inFlight = null;
    registry.delete(this.key);
    logger.info(LOG_TAG.media, "upload_cancelled", { client_msg_id: this.key, upload_id: this.uploadId ?? "-" });
    this.rejectFn(new UploadCancelledError());
  }

  /** 链上每个 await 续步的通行检查：终态/取消/暂停/换代 → 本链退出。 */
  private alive(gen: number): boolean {
    return !this.cancelled && !this.finished && !this.paused && gen === this.generation;
  }

  private async api(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const ac = new AbortController();
    this.inFlight = ac;
    const resp = await tracedFetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init.headers as Record<string, string> | undefined) },
      signal: ac.signal,
    });
    const text = await resp.text().catch(() => "");
    let body: { code?: number; message?: string; data?: Record<string, unknown> } | null = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    // 非 JSON / 无 code 字段（网关 502 HTML、5xx 空体、代理错误页）：这是**瞬时网络/网关故障**，
    // 服务端 offset 完好——必须走网络重试路径保留 offset，绝不能当业务拒绝清 upload_id 从 0 重传
    // （否则一次代理抖动就白传已上传的 1.9GB）。抛普通 Error（非 BusinessError）即落到 catch 的网络分支。
    if (!body || typeof body.code !== "number") {
      throw new Error(`服务器响应异常 (HTTP ${resp.status})`);
    }
    if (body.code !== 0) throw new BusinessError(body.code, friendlyMessage(body.code, body.message || "上传失败"));
    return body.data ?? {};
  }

  private async runChain(gen: number): Promise<void> {
    try {
      let offset: number;
      if (!this.uploadId) {
        const d = await this.api("/api/v1/upload/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: this.file.name || "file.bin", size: this.file.size }),
        });
        if (!this.alive(gen)) return;
        this.uploadId = String(d.upload_id ?? "");
        offset = 0;
      } else {
        const d = await this.api(`/api/v1/upload/${this.uploadId}/status`, { method: "GET" });
        if (!this.alive(gen)) return;
        offset = Number(d.offset ?? 0);
      }
      while (offset < this.file.size) {
        this.onProgress?.(offset, this.file.size);
        const chunk = this.file.slice(offset, offset + CHUNK_SIZE);
        const d = await this.api(`/api/v1/upload/${this.uploadId}/chunk?offset=${offset}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: chunk,
        });
        if (!this.alive(gen)) return;
        offset = Number(d.offset ?? 0); // 服务端返回的 offset 是权威值：乱序/重复自动对齐
        this.netRetryCount = 0;         // 有分片落地即清零：只有**连续**网络失败才升级为整体失败
      }
      this.onProgress?.(this.file.size, this.file.size);
      const d = await this.api(`/api/v1/upload/${this.uploadId}/complete`, { method: "POST" });
      if (this.cancelled || this.finished || gen !== this.generation) return; // complete 不看 paused：都传完了
      this.finished = true;
      registry.delete(this.key);
      const size = Number(d.size);
      this.resolveFn({
        url: String(d.url ?? ""),
        contentType: String(d.content_type ?? "file"),
        size: Number.isFinite(size) && size > 0 ? size : this.file.size,
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return; // 暂停/取消主动中断：新链或终态已接管
      if (this.cancelled || this.finished || gen !== this.generation) return;
      // 暂停期间到达的迟到错误（响应体已被 tracedFetch 缓冲、abort 慢一步）一律不推进——
      // 否则业务错误会在暂停期偷偷 init 新会话（违反"暂停期间零新请求"，恢复后从 0 重传）。恢复时会重跑链。
      if (this.paused) return;
      if (e instanceof BusinessError) {
        // 仅"上传会话不存在/已过期"值得换新会话从 0 重传自愈；类型/大小/配额/鉴权等确定性拒绝
        // 重试必再失败，且非 JSON 网关错误已在 api() 归为网络失败——都不该走这条从头重传的路。
        if (e.code === SESSION_LOST_CODE && this.restartCount < 2) {
          this.restartCount += 1;
          logger.warn(LOG_TAG.media, "upload_session_lost_restarting", {
            client_msg_id: this.key, old_upload_id: this.uploadId ?? "-", attempt: this.restartCount, error: e.message,
          });
          this.uploadId = undefined; // 作废死会话，换新会话从 0 传
          void this.runChain(++this.generation);
          return;
        }
        this.fail(e); // 确定性业务拒绝：立即失败，不重试
        return;
      }
      // 网络/瞬时失败（超时、断网、502 HTML）：offset 在服务端，2s 退避自动续，连续失败才交给用户。
      if (this.netRetryCount >= 2) { this.fail(e as Error); return; }
      this.netRetryCount += 1;
      logger.warn(LOG_TAG.media, "upload_net_retry", { client_msg_id: this.key, attempt: this.netRetryCount, error: (e as Error).message });
      const genNow = ++this.generation;
      setTimeout(() => {
        if (!this.cancelled && !this.finished && !this.paused && genNow === this.generation) void this.runChain(genNow);
      }, 2000);
    }
  }

  private fail(e: Error): void {
    this.finished = true;
    registry.delete(this.key);
    this.rejectFn(e);
  }
}

/**
 * 启动一条分片上传。每次发送/重试都用全新 key（outbox-uuid），不存在同 key 复用场景，
 * 故不做去重分支（暂停/取消/续传都经 chunkedTaskFor(key) 直接操作任务对象）。
 */
export function startChunkedUpload(
  file: File,
  token: string,
  key: string,
  onProgress?: (sent: number, total: number) => void,
): Promise<ChunkedResult> {
  return new ChunkedUploadTask(file, token, key, onProgress).promise;
}
