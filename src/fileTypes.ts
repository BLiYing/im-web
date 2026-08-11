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

export function fileTypeForName(value: string | null | undefined): FileTypeKind {
  const extension = extensionOf(value || "");
  return RULES.find(([, extensions]) => extensions.has(extension))?.[0] ?? "unknown";
}

// 「图片或视频」入口允许的扩展名（与服务端 allowedUploadExt 的 image/video 段同口径）。
// 刻意不含 svg：服务端拒收（防上传目录成 XSS 入口），客户端同步拒绝、早失败早提示。
const MEDIA_IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "ico", "raw", "dng"]);
const MEDIA_VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v", "avi", "mkv", "wmv", "flv", "mpg", "mpeg", "3gp"]);

/**
 * 媒体入口（图片或视频）的类型闸：判定一个 File 是否为可发送的图片/视频，返回归类；否则 null（应拒收）。
 * 判据 = MIME 前缀优先（image/、video/），MIME 缺失或不可信时回退扩展名白名单——
 * 覆盖 accept 只是 UI 提示、可被"所有文件"/拖拽/粘贴绕过的场景。svg 一律拒绝。
 * 客户端此闸只为体验（早提示、少一次上传往返）；安全边界仍在服务端。
 */
export function mediaKindForFile(file: { name: string; type: string }): "image" | "video" | null {
  const mime = (file.type || "").toLowerCase();
  const ext = extensionOf(file.name || "");
  if (mime === "image/svg+xml" || ext === "svg") return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  // MIME 缺失（部分浏览器拖拽/粘贴场景不带 type）→ 回退扩展名白名单
  if (MEDIA_IMAGE_EXT.has(ext)) return "image";
  if (MEDIA_VIDEO_EXT.has(ext)) return "video";
  return null;
}
