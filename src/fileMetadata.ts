/**
 * 文件大小以协议持久化的原始字节数为准；这里只负责展示，不读取或重新下载文件。
 * 产品统一使用 1024 进制的 KB / MB / GB，最多保留一位小数。
 */
export function formatFileSize(bytes?: number): string {
  if (!Number.isFinite(bytes) || bytes === undefined || bytes < 0) return "";
  if (bytes === 0) return "0 KB";
  const value = bytes >= 1024 ** 3
    ? bytes / 1024 ** 3
    : bytes >= 1024 ** 2
      ? bytes / 1024 ** 2
      : bytes / 1024;
  const unit = bytes >= 1024 ** 3 ? "GB" : bytes >= 1024 ** 2 ? "MB" : "KB";
  const shown = Math.max(0.1, value);
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(shown)} ${unit}`;
}
