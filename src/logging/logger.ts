export const LOG_TAG = {
  app: "IM.APP",
  http: "IM.HTTP",
  ws: "IM.WS",
  store: "IM.STORE",
  ui: "IM.UI",
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
  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleRejection);
  window.__IMLoggingCleanup = () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
  };
  logger.info(LOG_TAG.app, "logger_ready", {
    level: minimumLevel,
    capacity: MAX_ENTRIES,
    diagnostics: "window.IMDiagnostics",
  });
}
