import { useEffect } from "react";
import { ExpiredViewerPage } from "./ExpiredCover";
import { useProbeExpiry } from "../ChatActionsContext";
import { ChevronLeft, ChevronRight, Play, Download, LayoutGrid, MoreHorizontal, X } from "lucide-react";
import type { ChatMessage } from "../sdk/protocol";
import { videoFrameSrc } from "../messageContent";
import { useT } from "../i18n";
import { ZoomableImage } from "./ZoomableImage";
import { VideoFrame } from "./VideoFrame";

/** 媒体查看器（镜像 iOS）：图片/视频 + 右下 下载/媒体库/更多（点击浮层 6 功能）。点击遮罩关闭。
 *  纯展示：所有派生态（可播/已开始/失效/不支持/翻页位点）与动作由 App 注入，逐字保持原交互。 */
export function MediaViewer({
  m, fromGallery, videoUnplayable, videoStarted, isExpired, unsupported, mediaKey,
  viewerIdx, viewerCount, hasOlder, hasNewer, chatTitle, more,
  onClose, onDismissMore, onStartVideo, onVideoError, onImageError,
  onNav, onToggleMore, onOpenGallery, onLocate, onFavorite, onCopy, onForward, onDelete,
}: {
  m: ChatMessage;
  fromGallery?: boolean;
  videoUnplayable: boolean;
  videoStarted: boolean;
  isExpired: boolean; // expiredSet.has(m.content)
  unsupported: boolean; // 网页端无法渲染的图片格式（HEIC 等）
  mediaKey: string; // msgKey(m)：翻页换元素时重挂
  viewerIdx: number; // <0 表示不在会话媒体时间线内（如收藏/记录进入）
  viewerCount: number;
  /** 服务端还有更旧的媒体（本地有缺口时续拉）：第一张上也要给左箭头。 */
  hasOlder?: boolean;
  /** 服务端还有更新的媒体（本地段上沿之外）：最后一张上也要给右箭头。 */
  hasNewer?: boolean;
  chatTitle: string;
  more: boolean;
  onClose: () => void;
  onDismissMore: () => void;
  onStartVideo: () => void;
  onVideoError: () => void;
  onImageError: () => void;
  onNav: (delta: number) => void;
  onToggleMore: () => void;
  onOpenGallery: () => void;
  onLocate: () => void;
  onFavorite: () => void;
  onCopy: () => void;
  onForward: () => void;
  onDelete: (x: number, y: number) => void;
}) {
  const tr = useT();
  // 进查看器复验一次：命中浏览器缓存的图不会 onError，列表里又不批量探；每地址每会话一次，命中落持久失效标记
  const probe = useProbeExpiry();
  useEffect(() => { if (!isExpired) probe?.(m, true); }, [m.content]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="modal-mask viewer-mask" onClick={onClose}>
      {isExpired ? (
        // 服务端已清理（404/410）：图片 / 视频同一张失效页（黑底 + 八角 ✕ + 一行文案），不建 <video>、不画破图、不给下载
        // ——对齐 Android `ExpiredViewerPage`。onError 复验命中后 isExpired 翻真，自动切到这一页。
        <ExpiredViewerPage caption={m.contentType === "video" ? tr("media.video_expired") : tr("media.image_expired")} />
      ) : m.contentType === "video" ? (
        // 浏览器解不了码（对端发来的 HEVC 等）时 <video> 只会黑屏 → 降级成明确提示 + 下载入口，
        // 而不是让用户对着黑框以为坏了。封面仍能显示（poster 是 JPEG，与视频编码无关）。
        videoUnplayable ? (
          <div className="viewer-unplayable" onClick={(e) => e.stopPropagation()}>
            {m.posterUrl && <img src={m.posterUrl} alt="" />}
            <p>{tr("media.viewer.video_unsupported")}</p>
            <a className="viewer-unplayable-btn" href={m.content} download>{tr("media.viewer.download_open_player")}</a>
          </div>
        ) : !videoStarted ? (
          // 封面待点：只显封面图 + 居中 ▶，点了才挂 <video>。翻页到视频＝翻到图片一样轻，无黑色控件条/无 metadata 预拉。
          // 没有封面也没有缩略（转发时丢了 poster/thumb 的老消息，落库后补不回来）→ 退回 <video> 首帧，
          // 与气泡 / 宫格 / 引用缩略同一兜底；否则 <img> 没有 src 什么都不画，黑底上只剩一个 ▶。
          // 这一支才预拉 metadata，有封面的照旧不拉。首帧都解不出就直接进降级卡，不必等用户点播放。
          <>
            {m.posterUrl || m.thumb ? (
              <img className="image-viewer viewer-video-cover" src={m.posterUrl || m.thumb} alt={tr("chat.media.alt_video_cover")}
                   onClick={(e) => { e.stopPropagation(); onDismissMore(); onStartVideo(); }} />
            ) : (
              <VideoFrame key={mediaKey} className="image-viewer viewer-video-cover" src={videoFrameSrc(m.content)}
                     onClick={(e) => { e.stopPropagation(); onDismissMore(); onStartVideo(); }}
                     onError={onVideoError} />
            )}
            <button className="viewer-play-btn" title={tr("common.play")} onClick={(e) => { e.stopPropagation(); onStartVideo(); }}>
              <Play size={30} fill="currentColor" />
            </button>
          </>
        ) : (
          <video key={mediaKey /* 翻页换视频时重挂元素，避免上一段播放状态残留 */}
                 className="image-viewer" src={m.content} controls autoPlay
                 poster={m.posterUrl}
                 onClick={(e) => { e.stopPropagation(); onDismissMore(); }}
                 onError={onVideoError} />
        )
      ) : unsupported ? (
        // 网页端无法渲染的图片格式（HEIC 等）：不塞进 <img> 变破图，显缩略(若有)+提示+下载入口（与视频降级卡同版式）。
        <div className="viewer-unplayable" onClick={(e) => e.stopPropagation()}>
          {m.thumb && <img src={m.thumb} alt="" />}
          <p>{tr("media.viewer.image_unsupported")}</p>
          <a className="viewer-unplayable-btn" href={m.content} download>{tr("media.viewer.download_open_local")}</a>
        </div>
      ) : (
        // 图片可缩放/平移（滚轮·捏合·双击·拖拽·键盘，见 ZoomableImage）；key 随消息换 → 翻页自动回 1×。视频不缩放。
        <ZoomableImage key={mediaKey} src={m.content} alt={tr("chat.media.alt_large")} onTap={onDismissMore} onError={onImageError} />
      )}
      {/* 任务3 · 左右翻页箭头：仅当前查看项在会话媒体时间线内（viewerIdx>=0）且有相邻项时显示。翻到头即停。 */}
      {(viewerIdx > 0 || (viewerIdx === 0 && hasOlder)) && (
        <button className="viewer-nav prev" title={tr("media.viewer.prev")}
                onClick={(e) => { e.stopPropagation(); onNav(-1); }}><ChevronLeft size={28} /></button>
      )}
      {viewerIdx >= 0 && (viewerIdx < viewerCount - 1 || (viewerIdx === viewerCount - 1 && hasNewer)) && (
        <button className="viewer-nav next" title={tr("media.viewer.next")}
                onClick={(e) => { e.stopPropagation(); onNav(1); }}><ChevronRight size={28} /></button>
      )}
      {/* 顶部标题栏（对齐 iOS）：主标题=会话名，副标题=「第 i 张 / 共 N 张」。带渐变底、预留高度，
          取代原先浮在图上的孤立计数（与图片重叠）。仅会话媒体上下文（viewerIdx>=0）显示。 */}
      {viewerIdx >= 0 && (
        // pointer-events:none（见 .viewer-top）——点击穿透到蒙层关闭，无需 stopPropagation。
        <div className="viewer-top">
          <span className="viewer-top-title">{chatTitle}</span>
          {viewerCount > 1 && (
            <span className="viewer-top-count">{viewerIdx + 1} / {viewerCount}</span>
          )}
        </div>
      )}
      {/* 左上角关闭（iOS/Android 都有 ✕）：此前只能点黑底关，找不到入口 */}
      <button className="viewer-btn viewer-close" title={tr("common.close")}
              onClick={(e) => { e.stopPropagation(); onClose(); }}><X size={18} /></button>
      {/* 右下角三枚钮顺序与 iOS / Android 同：更多 · 媒体库 · 下载（下载恒在最右） */}
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-more-wrap">
          {/* 点击切换（原 hover：鼠标从按钮移向弹窗时穿过间隙触发 onMouseLeave 即消失，够不到菜单项）。 */}
          <button className="viewer-btn" title={tr("common.more")} onClick={(e) => { e.stopPropagation(); onToggleMore(); }}><MoreHorizontal size={18} /></button>
          {more && (
            <div className="viewer-more-pop">
              {/* 项与顺序和 iOS / Android 查看器「更多」同一份：下载 · 定位 · 收藏 · 复制 · 转发 · 删除；
                  失效页去掉要字节的项（下载/收藏/复制/转发）。 */}
              {!isExpired && <a href={m.content} download>{tr("common.download")}</a>}
              <button onClick={onLocate}>{tr("media.viewer.locate")}</button>
              {!isExpired && <button onClick={onFavorite}>{tr("common.favorite")}</button>}
              {/* 视频不提供复制：无"复制字节"语义，产品上禁止复制视频消息（与 iOS 对齐）。图片才有复制。 */}
              {!isExpired && m.contentType !== "video" && (
                <button onClick={onCopy}>{tr("common.copy")}</button>
              )}
              {!isExpired && <button onClick={onForward}>{tr("common.forward")}</button>}
              <button className="danger" onClick={(e) => onDelete(e.clientX, e.clientY)}>{tr("common.delete")}</button>
            </div>
          )}
        </div>
        {!fromGallery && (
          <button className="viewer-btn" title={tr("media.viewer.gallery")} onClick={onOpenGallery}><LayoutGrid size={18} /></button>
        )}
        {!isExpired && <a className="viewer-btn" href={m.content} download title={tr("common.download")}><Download size={18} /></a>}
      </div>
    </div>
  );
}
