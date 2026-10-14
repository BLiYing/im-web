import { useEffect, useState } from "react";
import { decodeHeicToJpeg } from "../heicDecode";
import { useT } from "../i18n";
import { ZoomableImage } from "./ZoomableImage";

/** 查看器里的 HEIC/HEIF：本地解码成 JPEG 后走与普通图相同的 ZoomableImage。
 *  解码中显示缩略（若有）+ 一行提示；失败回调 onFail，由上层落回「下载后用本地程序打开」降级卡。
 *  `key={mediaKey}` 由调用方给：翻页即新实例，objectURL 在卸载时回收。 */
export function HeicViewerImage({ src, thumb, onTap, onFail }: {
  src: string;
  thumb?: string;
  onTap: () => void;
  onFail: () => void;
}) {
  const tr = useT();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    let made: string | null = null;
    decodeHeicToJpeg(src, ctl.signal)
      .then((blob) => {
        if (ctl.signal.aborted) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => { if (!ctl.signal.aborted) onFail(); });
    return () => {
      ctl.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  if (url) return <ZoomableImage src={url} alt={tr("chat.media.alt_large")} onTap={onTap} onError={onFail} />;
  return (
    <div className="viewer-unplayable" onClick={(e) => e.stopPropagation()}>
      {thumb && <img src={thumb} alt="" />}
      <p>{tr("media.viewer.image_decoding")}</p>
    </div>
  );
}
