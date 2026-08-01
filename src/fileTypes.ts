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
