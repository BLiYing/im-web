const MAX_BODY_CHARS = 16 * 1024;
const ALWAYS_SENSITIVE = new Set([
  "password", "passwd", "passcode", "secret", "clientsecret",
  "token", "accesstoken", "refreshtoken", "idtoken", "jwt",
  "authorization", "cookie", "setcookie",
  "phone", "phonenumber", "mobile", "telephone",
]);
const BUSINESS_CONTENT = new Set([
  "content", "text", "note", "reason", "resolution", "translation", "description", "remark",
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function dataURIMetadata(value: string): string | null {
  if (!value.toLowerCase().startsWith("data:")) return null;
  const comma = value.indexOf(",");
  if (comma < 0) return null;
  const descriptor = value.slice(5, comma);
  const mediaType = descriptor.split(";")[0] || "unknown";
  return `<data-uri type=${mediaType} chars=${value.length}>`;
}

export function sanitizeValue(value: unknown, includeBusinessContent: boolean): unknown {
  if (Array.isArray(value)) return value.map((child) => sanitizeValue(child, includeBusinessContent));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const normalized = normalizedKey(key);
      if (ALWAYS_SENSITIVE.has(normalized) || (!includeBusinessContent && BUSINESS_CONTENT.has(normalized))) {
        result[key] = "***";
      } else {
        result[key] = sanitizeValue(child, includeBusinessContent);
      }
    }
    return result;
  }
  if (typeof value === "string") return dataURIMetadata(value) ?? value;
  return value;
}

function truncate(value: string): string {
  if (value.length <= MAX_BODY_CHARS) return value;
  return `${value.slice(0, MAX_BODY_CHARS)}…<truncated ${value.length - MAX_BODY_CHARS} chars>`;
}

function jsonText(value: unknown, includeBusinessContent: boolean): string {
  try {
    return truncate(JSON.stringify(sanitizeValue(value, includeBusinessContent)));
  } catch {
    return "<unserializable>";
  }
}

export function formatRequestBody(body: BodyInit | null | undefined, includeBusinessContent: boolean): string {
  if (body == null) return "<empty>";
  if (typeof body === "string") {
    try {
      return jsonText(JSON.parse(body), includeBusinessContent);
    } catch {
      return includeBusinessContent ? truncate(body) : `<non-json redacted ${body.length} chars>`;
    }
  }
  if (body instanceof URLSearchParams) {
    const fields: Record<string, string> = {};
    body.forEach((value, key) => { fields[key] = value; });
    return jsonText(fields, includeBusinessContent);
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const fields: Record<string, unknown> = {};
    body.forEach((value, key) => {
      fields[key] = typeof value === "string"
        ? sanitizeValue(value, includeBusinessContent)
        : `<file name=${value.name} type=${value.type || "unknown"} bytes=${value.size}>`;
    });
    return `<multipart ${jsonText(fields, includeBusinessContent)}>`;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return `<blob type=${body.type || "unknown"} bytes=${body.size}>`;
  }
  if (body instanceof ArrayBuffer) return `<binary ${body.byteLength} bytes>`;
  if (ArrayBuffer.isView(body)) return `<binary ${body.byteLength} bytes>`;
  return `<${body.constructor?.name || "body"}>`;
}

export function formatResponseText(text: string, contentType: string | null, includeBusinessContent: boolean): string {
  if (!text) return "<empty>";
  const isJSON = contentType?.toLowerCase().includes("json") ?? false;
  const trimmed = text.trimStart();
  if (isJSON || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return jsonText(JSON.parse(text), includeBusinessContent);
    } catch {
      if (isJSON) return "<invalid-json>";
    }
  }
  return includeBusinessContent ? truncate(text) : `<non-json redacted ${text.length} chars>`;
}
