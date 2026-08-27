import { LOG_TAG, logger } from "../logging/logger";
import { formatRequestBody, formatResponseText } from "../logging/sanitize";
import { friendlyMessage } from "./errcode";

const includeBusinessContent = import.meta.env.DEV;

function requestPath(input: RequestInfo | URL): string {
  if (input instanceof Request) return requestPath(input.url);
  try {
    const url = new URL(String(input), typeof location === "undefined" ? "http://localhost" : location.origin);
    return url.pathname;
  } catch {
    return String(input).split("?")[0];
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function bodyBytes(body: BodyInit | null | undefined): number | undefined {
  if (body == null) return 0;
  if (typeof body === "string") return new TextEncoder().encode(body).byteLength;
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString()).byteLength;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return undefined;
}

/** 上传进度回调：sent/total 均为**请求体**字节数（含 multipart 头，略大于文件本身）。 */
export type UploadProgressHandler = (sent: number, total: number) => void;

/**
 * 上传专用的 XHR 版 tracedFetch。fetch 不提供上行进度事件，媒体上传要显示「已传 / 总大小」
 * 只能走 XMLHttpRequest.upload.onprogress。日志字段与 tracedFetch 保持一致（req/method/path/
 * status/duration_ms/bytes），跨端 Request ID 契约不变（见 docs/LOGGING.md）。
 */
export function tracedUpload(
  path: string,
  body: FormData,
  opts: { headers?: Record<string, string>; onProgress?: UploadProgressHandler } = {},
): Promise<{ status: number; text: string }> {
  const requestID = crypto.randomUUID();
  const started = performance.now();
  logger.info(LOG_TAG.http, "request", { req: requestID, method: "POST", path, body: "[multipart]" });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path, true);
    xhr.setRequestHeader("X-Request-ID", requestID);
    Object.entries(opts.headers ?? {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress!(e.loaded, e.total); };
    }
    xhr.onload = () => {
      const fields = {
        req: xhr.getResponseHeader("X-Request-ID") || requestID,
        method: "POST", path, status: xhr.status,
        duration_ms: Math.round((performance.now() - started) * 10) / 10,
        bytes: new TextEncoder().encode(xhr.responseText || "").byteLength,
      };
      if (xhr.status >= 200 && xhr.status < 300) logger.info(LOG_TAG.http, "response", fields);
      else logger.warn(LOG_TAG.http, "response", fields);
      resolve({ status: xhr.status, text: xhr.responseText || "" });
    };
    xhr.onerror = () => {
      logger.error(LOG_TAG.http, "transport_error", {
        req: requestID, method: "POST", path,
        duration_ms: Math.round((performance.now() - started) * 10) / 10,
      });
      reject(new Error("网络错误，上传失败"));
    };
    xhr.send(body);
  });
}

export async function tracedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const requestID = headers.get("X-Request-ID") || crypto.randomUUID();
  headers.set("X-Request-ID", requestID);

  const method = requestMethod(input, init);
  const path = requestPath(input);
  const body = init.body ?? (input instanceof Request ? await input.clone().blob() : undefined);
  const started = performance.now();
  logger.info(LOG_TAG.http, "request", {
    req: requestID,
    method,
    path,
    bytes: bodyBytes(body),
    body: formatRequestBody(body, includeBusinessContent),
  });

  let response: Response;
  try {
    response = await fetch(input, { ...init, headers });
  } catch (error) {
    logger.error(LOG_TAG.http, "transport_error", {
      req: requestID,
      method,
      path,
      duration_ms: Math.round((performance.now() - started) * 10) / 10,
      error,
    });
    throw error;
  }

  const responseText = await response.clone().text().catch(() => "");
  const responseRequestID = response.headers.get("X-Request-ID") || requestID;
  const fields = {
    req: responseRequestID,
    method,
    path,
    status: response.status,
    duration_ms: Math.round((performance.now() - started) * 10) / 10,
    bytes: new TextEncoder().encode(responseText).byteLength,
    body: formatResponseText(responseText, response.headers.get("Content-Type"), includeBusinessContent),
  };
  if (response.ok) logger.info(LOG_TAG.http, "response", fields);
  else logger.warn(LOG_TAG.http, "response", fields);
  return response;
}

/** 统一响应信封（后端 errcode 契约）。 */
export type Envelope<T = unknown> = { code: number; message?: string; data?: T };

/**
 * tracedFetch + 解析 JSON，把"连不上 / 空响应"这类传输层失败转成友好中文（区别于业务错误码）。
 * 返回**原始信封**（含 code / message / data），调用方自己按 code 分支。用于罕见的"探活"场景
 * （如 fetchToken 中的 /devices 校验，要区分 code=100101 吊销 vs code=0 有效 vs 其它）。
 */
export async function fetchEnvelope<T = any>(input: RequestInfo | URL, init?: RequestInit): Promise<Envelope<T>> {
  let resp: Response;
  try {
    resp = await tracedFetch(input, init);
  } catch {
    throw new Error("无法连接服务器，请确认后端已启动"); // fetch reject：网络/连接失败
  }
  try {
    return await resp.json();
  } catch {
    throw new Error("服务器无响应，请确认后端已启动"); // 空/非 JSON：原"Unexpected end of JSON input"
  }
}

/**
 * fetchEnvelope + 信封解包：`code!==0` 抛带业务码的 Error（`.code` 挂在 error 上供调用方按码分支，
 * 如 100002 限流、200110 二维码失效、300210 入群待审），`.message` 已本地化为中文（走 friendlyMessage
 * 码表 → 未收录码回退服务端原文）。这是 SDK 调用点的默认解包方式。
 */
export async function callJson(input: RequestInfo | URL, init?: RequestInit): Promise<any> {
  const body = await fetchEnvelope(input, init);
  if (body.code !== 0) {
    const err = new Error(friendlyMessage(body.code, body.message ?? "")) as Error & { code?: number };
    err.code = body.code;
    throw err;
  }
  return body.data;
}
