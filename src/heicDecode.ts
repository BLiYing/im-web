// HEIC/HEIF → JPEG（浏览器本地解码）。Chrome / Firefox / Electron 的 <img> 解不了 HEIC，
// iOS「原图」直传的就是 HEIC 字节；这里在查看器兜底转成 JPEG blob 再显示。
// heic2any 自带 libheif 的 WASM（>1MB），只在真遇到 HEIC 时动态 import，不进主包。

const HEIC_EXT = /\.(heic|heif)(?:$|[?#])/i;

/** URL / 文件名是否 HEIC 或 HEIF（按扩展名；服务端落盘名保留了原扩展）。 */
export function isHeicLike(nameOrUrl: string): boolean {
  return HEIC_EXT.test(nameOrUrl || "");
}

/** 下载并解码为 JPEG blob。失败（网络、非 HEIC 内容、WASM 解码出错）一律抛出，由调用方降级。 */
export async function decodeHeicToJpeg(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const src = await res.blob();
  const { default: heic2any } = await import("heic2any");
  const out = await heic2any({ blob: src, toType: "image/jpeg", quality: 0.92 });
  const blob = Array.isArray(out) ? out[0] : out; // 多帧 HEIC 取首帧
  if (!blob) throw new Error("empty decode");
  return blob;
}
