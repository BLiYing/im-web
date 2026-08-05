export const LOG_TAG = {
  app: "IM.APP",
  http: "IM.HTTP",
  ws: "IM.WS",
  store: "IM.STORE",
  ui: "IM.UI",
  // 媒体全链路（探测 → 上传 → 渲染 → 播放）单独成桶，便于一条过滤捞出整条链路；与 iOS IM.MEDIA 对齐。
  media: "IM.MEDIA",
} as const;

export type LogTag = (typeof LOG_TAG)[keyof typeof LOG_TAG];
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  tag: LogTag;
  event: string;
  fields?: Record<string, unknown>;
}

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
const levelWeight: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let minimumLevel: LogLevel = import.meta.env.DEV ? "debug" : "warn";

function normalizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((child) => normalizeValue(child, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "<circular>";
    seen.add(value);
    const normalized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) normalized[key] = normalizeValue(child, seen);
    return normalized;
  }
  return value;
}

// ── 开发期日志落盘（dev-only sink）──────────────────────────────────────────
// 浏览器进程读不到本地磁盘，也无法让人「翻日志文件」。开发期把每条结构化日志批量 POST 到
// Vite 中间件（见 vite.config.ts 的 im-dev-log-sink）落到 im-web/dev-logs/im-web.log，
// 排查时直接读该文件即可，无需手动复制控制台。
//   · 只在 DEV + 浏览器环境启用；vitest 用 node 环境（无 window）天然不触发，另加 MODE 守卫双保险。
//   · 用原生 fetch/sendBeacon（不经 tracedFetch），否则「上报日志的请求」又被记进日志 → 死循环。
//   · 批量 + 500ms 去抖，页面隐藏/卸载时用 sendBeacon 兜底冲刷；全程失败静默（落盘只是辅助）。
const SINK_URL = "/__devlog";
const sinkEnabled =
  import.meta.env.DEV && import.meta.env.MODE !== "test" && typeof window !== "undefined";
let sinkBuffer: string[] = [];
let sinkTimer: ReturnType<typeof setTimeout> | null = null;

// 来源标签（与 iOS IMRemoteLogSink 对齐）：多标签页/多账号汇聚到同一 im-web.log 时用于 grep 分离。
//   · dev = 每标签页一个短 id（页面加载时生成一次；每个浏览器标签是独立 page load，故可区分标签）。
//   · uid = 当前登录账号，由 App 经 setLogContext 注入（登录/切号时更新）；未登录为 "-"。
// 这是 grep 过滤标签，不是安全边界（/__devlog 本就 dev-only 无鉴权）。
const logDev =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
let logUid = "-";

/** 由 App 在 uid 确定/变更时调用，使后续每条上报都带上账号标签。 */
export function setLogContext(uid: string | null | undefined): void {
  logUid = uid && uid.length > 0 ? uid : "-";
}

function flushSink(useBeacon = false): void {
  if (sinkTimer !== null) { clearTimeout(sinkTimer); sinkTimer = null; }
  if (sinkBuffer.length === 0) return;
  const payload = sinkBuffer.join("\n") + "\n";
  sinkBuffer = [];
  if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(SINK_URL, new Blob([payload], { type: "text/plain" }));
    return;
  }
  void fetch(SINK_URL, { method: "POST", body: payload, keepalive: true }).catch(() => { /* 落盘失败不影响主流程 */ });
}

function shipToSink(entry: LogEntry): void {
  if (!sinkEnabled) return;
  // dev/uid 置于顶层（与 iOS 一致），便于 `grep '"uid":"1006"'` / `grep '"dev":"…"'` 分离来源。
  sinkBuffer.push(JSON.stringify({ dev: logDev, uid: logUid, ...entry }));
  if (sinkBuffer.length >= 50) { flushSink(); return; } // 攒够一批立刻送，避免缓冲无界
  if (sinkTimer === null) sinkTimer = setTimeout(() => { sinkTimer = null; flushSink(); }, 500);
}

function write(level: LogLevel, tag: LogTag, event: string, fields?: Record<string, unknown>): void {
  if (levelWeight[level] < levelWeight[minimumLevel]) return;
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    tag,
    event,
    ...(fields ? { fields: normalizeValue(fields) as Record<string, unknown> } : {}),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  const method = level === "debug" ? "debug" : level === "info" ? "info" : level === "warn" ? "warn" : "error";
  const suffix = entry.fields ? ` ${JSON.stringify(entry.fields)}` : "";
  console[method](`[${tag}] ${event}${suffix}`);
  shipToSink(entry);
}

export const logger = {
  debug: (tag: LogTag, event: string, fields?: Record<string, unknown>) => write("debug", tag, event, fields),
  info: (tag: LogTag, event: string, fields?: Record<string, unknown>) => write("info", tag, event, fields),
  warn: (tag: LogTag, event: string, fields?: Record<string, unknown>) => write("warn", tag, event, fields),
  error: (tag: LogTag, event: string, fields?: Record<string, unknown>) => write("error", tag, event, fields),
};

export function setLogLevel(level: LogLevel): void {
  minimumLevel = level;
}

export function diagnosticEntries(): readonly LogEntry[] {
  return entries.map((entry) => ({ ...entry, fields: entry.fields ? { ...entry.fields } : undefined }));
}

export function exportDiagnosticLogs(): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

export function clearDiagnosticLogs(): void {
  entries.length = 0;
}

export async function copyDiagnosticLogs(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("当前浏览器不支持剪贴板 API");
  }
  await navigator.clipboard.writeText(exportDiagnosticLogs());
}

declare global {
  interface Window {
    IMDiagnostics: {
      copyLogs: () => Promise<void>;
      exportLogs: () => string;
      clearLogs: () => void;
    };
    __IMLoggingCleanup?: () => void;
  }
}

export function installGlobalLogging(): void {
  if (typeof window === "undefined") return;
  window.__IMLoggingCleanup?.();
  window.IMDiagnostics = {
    copyLogs: copyDiagnosticLogs,
    exportLogs: exportDiagnosticLogs,
    clearLogs: clearDiagnosticLogs,
  };
  const handleError = (event: ErrorEvent) => {
    logger.error(LOG_TAG.app, "uncaught_error", {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error,
    });
  };
  const handleRejection = (event: PromiseRejectionEvent) => {
    logger.error(LOG_TAG.app, "unhandled_rejection", { reason: event.reason });
  };
  // 页面隐藏/卸载时把攒着的日志用 sendBeacon 冲刷落盘（keepalive fetch 在卸载时不保证送达）。
  const handleHidden = () => { if (document.visibilityState === "hidden") flushSink(true); };
  const handlePageHide = () => flushSink(true);
  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleRejection);
  document.addEventListener("visibilitychange", handleHidden);
  window.addEventListener("pagehide", handlePageHide);
  window.__IMLoggingCleanup = () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
    document.removeEventListener("visibilitychange", handleHidden);
    window.removeEventListener("pagehide", handlePageHide);
  };
  logger.info(LOG_TAG.app, "logger_ready", {
    level: minimumLevel,
    capacity: MAX_ENTRIES,
    diagnostics: "window.IMDiagnostics",
  });
}
