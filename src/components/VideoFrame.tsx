import type { MouseEvent } from "react";
import { usePowerEffective } from "../usePowerSaving";

/** 视频首帧预览（无 posterUrl 时的兜底）：「视频预加载」有效 → `<video preload="metadata">` 拉首帧；
 *  关闭或省电生效 → 不渲染 <video>（不拉流），改显消息自带的 thumb（.gate-blur 同款模糊）或空占位。
 *  POWER_SAVING_DESIGN §4.3。点开播放走原路径，不受影响。 */
export function VideoFrame({ src, thumb, className, thumbClass, emptyClass, onClick, onError, onLoadedData }: {
  src: string;
  thumb?: string;
  className?: string;
  /** 回退成 thumb 时用的 class（默认 `${className} gate-blur`）；气泡等有自己的模糊类时覆盖。 */
  thumbClass?: string;
  emptyClass?: string;
  onClick?: (e: MouseEvent) => void;
  onError?: () => void;
  onLoadedData?: () => void;
}) {
  const preload = usePowerEffective("videoPreload");
  if (preload) return <video className={className} src={src} preload="metadata" muted onClick={onClick} onError={onError} onLoadedData={onLoadedData} />;
  if (thumb) return <img className={thumbClass ?? `${className ?? ""} gate-blur`.trim()} src={thumb} alt="" onClick={onClick} onLoad={onLoadedData} />;
  return <span className={emptyClass ?? `${className ?? ""} gate-empty`.trim()} onClick={onClick} />;
}
