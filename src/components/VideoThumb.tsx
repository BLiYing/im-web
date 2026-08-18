import { videoFrameSrc } from "../messageContent";

/** 视频快照缩略：首帧封面 + ▶ 角标，点击进查看器。收藏 / 合并转发详情共用。
 *  videoClass 由调用方给（尺寸/圆角各页不同），外层 wrap 与角标统一。 */
export function VideoThumb({ content, videoClass, onClick }: {
  content: string;
  videoClass: string;
  onClick: () => void;
}) {
  return (
    <span className="fav-thumb-wrap" onClick={onClick}>
      <video className={videoClass} src={videoFrameSrc(content)} preload="metadata" muted /><span className="play-badge">▶</span>
    </span>
  );
}
