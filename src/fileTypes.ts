export type FileTypeKind =
  | "pdf" | "word" | "excel" | "powerpoint" | "csv"
  | "pages" | "numbers" | "keynote" | "text" | "markdown"
  | "xml" | "json" | "image" | "video" | "audio" | "archive"
  | "code" | "database" | "font" | "ebook" | "package" | "unknown";

const RULES: ReadonlyArray<readonly [FileTypeKind, ReadonlySet<string>]> = [
  ["pdf", new Set(["pdf"])],
  ["word", new Set(["doc", "docx", "docm", "dot", "dotx", "odt"])],
  ["excel", new Set(["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "ods"])],
  ["powerpoint", new Set(["ppt", "pptx", "pptm", "pps", "ppsx", "odp"])],
  ["csv", new Set(["csv", "tsv"])],
  ["pages", new Set(["pages"])],
  ["numbers", new Set(["numbers"])],
  ["keynote", new Set(["key"])],
  ["text", new Set(["txt", "rtf", "rtfd", "log"])],
  ["markdown", new Set(["md", "markdown"])],
  ["xml", new Set(["xml", "xsd", "xsl", "xslt", "plist"])],
  ["json", new Set(["json", "geojson"])],
  ["image", new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "svg", "ico", "raw", "dng", "psd"])],
  ["video", new Set(["mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv", "flv", "mpg", "mpeg", "3gp"])],
  ["audio", new Set(["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "wma", "aiff", "caf"])],
  ["archive", new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz"])],
  ["code", new Set(["html", "htm", "css", "scss", "less", "js", "jsx", "ts", "tsx", "swift", "m", "mm", "h", "c", "cc", "cpp", "cxx", "java", "kt", "kts", "py", "go", "rs", "rb", "php", "sh", "zsh", "yaml", "yml", "toml", "ini"])],
  ["database", new Set(["db", "sqlite", "sqlite3", "sql", "mdb", "accdb"])],
  ["font", new Set(["ttf", "otf", "woff", "woff2", "eot"])],
  ["ebook", new Set(["epub", "mobi", "azw", "azw3", "fb2"])],
  ["package", new Set(["dmg", "pkg", "exe", "msi", "apk", "ipa", "appimage", "deb", "rpm"])],
];

function extensionOf(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0];
  const segment = withoutQuery.split("/").pop() || "";
  let decoded = segment;
  try { decoded = decodeURIComponent(segment); } catch { /* 非法百分号编码按原文继续识别 */ }
  const dot = decoded.lastIndexOf(".");
  return dot >= 0 ? decoded.slice(dot + 1).toLowerCase() : "";
}

function kindForExtension(extension: string): FileTypeKind {
  return RULES.find(([, extensions]) => extensions.has(extension))?.[0] ?? "unknown";
}

export function fileTypeForName(value: string | null | undefined): FileTypeKind {
  return kindForExtension(extensionOf(value || ""));
}

// 本地文件名（File.name）取扩展名：不做 URL 的 ?# 截断——本地名里 # / ? 是普通字符，
// 按 URL 规则截断会让 "IMG #12.HEIC" 之类丢掉扩展名而被误判。仅取最后一个点后的片段。
function localExtensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * 媒体入口（图片或视频）的类型闸：判定一个 File 是否为可发送的图片/视频，返回归类；否则 null（应拒收）。
 * 判据 = MIME 前缀优先（image/、video/），MIME 缺失或不可信时回退扩展名（复用 RULES 分类表，不另立白名单）。
 * svg 一律拒绝（服务端拒收，防上传目录成 XSS 入口）；psd 不作可发送媒体。
 * 扩展名按**本地文件名**解析（localExtensionOf），覆盖 accept 只是 UI 提示、可被"所有文件"/拖拽/粘贴绕过的场景。
 * 客户端此闸只为体验（早提示、少一次上传往返）；安全边界仍在服务端。
 */
export function mediaKindForFile(file: { name: string; type: string }): "image" | "video" | null {
  const mime = (file.type || "").toLowerCase();
  const ext = localExtensionOf(file.name || "");
  if (mime === "image/svg+xml" || ext === "svg") return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  // MIME 缺失（部分浏览器拖拽/粘贴不带 type）→ 回退扩展名，复用 fileTypeForName 的 RULES 分类。
  const kind = kindForExtension(ext);
  if (kind === "image" && ext !== "psd") return "image";
  if (kind === "video") return "video";
  return null;
}

// 主流浏览器（Chrome/Firefox）在 <img>/<video> 里**解不了码**的格式黑名单——服务端/其它端可发，但网页端只会破图/黑屏。
// 用"黑名单"而非"白名单"：未知/新格式（含 blob:/data: 无扩展名）默认按"能渲染"处理、交给 onError 兜底，不误伤。
const WEB_UNRENDERABLE_IMAGE_EXT = new Set(["heic", "heif", "tif", "tiff", "raw", "dng", "psd"]);
const WEB_UNRENDERABLE_VIDEO_EXT = new Set(["mkv", "avi", "wmv", "flv", "mpg", "mpeg"]);

/**
 * 浏览器能否原生渲染该媒体（按扩展名判定，容器级）。用于：
 *   - 发送闸：网页端只允许发浏览器自己也能看的格式（否则发出去自己都看不了、还坑其它网页端）。
 *   - 展示层：命中黑名单直接画"无法预览·下载"降级卡，不塞进 <img> 变破图。
 * 注意：只挡**已知容器级**不支持；编解码级失败（如 mp4 里的 HEVC）扩展名看不出，仍需 <video> onError 兜底。
 * 无扩展名（blob:/data:/未知）→ 返回 true（不主动降级）。
 */
export function webCanRenderMedia(kind: "image" | "video", nameOrUrl: string): boolean {
  const ext = localExtensionOf(nameOrUrl || "");
  if (!ext) return true;
  if (kind === "image") return !WEB_UNRENDERABLE_IMAGE_EXT.has(ext);
  if (kind === "video") return !WEB_UNRENDERABLE_VIDEO_EXT.has(ext);
  return true;
}
