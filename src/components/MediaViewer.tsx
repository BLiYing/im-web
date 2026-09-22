import { ChevronLeft, ChevronRight, Play, Download, LayoutGrid, MoreHorizontal } from "lucide-react";
import type { ChatMessage } from "../sdk/protocol";
import { useT } from "../i18n";

/** 媒体查看器（镜像 iOS）：图片/视频 + 右下 下载/媒体库/更多（点击浮层 6 功能）。点击遮罩关闭。
 *  纯展示：所有派生态（可播/已开始/失效/不支持/翻页位点）与动作由 App 注入，逐字保持原交互。 */
export function MediaViewer({
  m, fromGallery, videoUnplayable, videoStarted, isExpired, unsupported, mediaKey,
  viewerIdx, viewerCount, chatTitle, more,
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
  return (
    <div className="modal-mask viewer-mask" onClick={onClose}>
      {m.contentType === "video" ? (
        // 浏览器解不了码（对端发来的 HEVC 等）时 <video> 只会黑屏 → 降级成明确提示 + 下载入口，
        // 而不是让用户对着黑框以为坏了。封面仍能显示（poster 是 JPEG，与视频编码无关）。
        videoUnplayable ? (
          <div className="viewer-unplayable" onClick={(e) => e.stopPropagation()}>
            {m.posterUrl && <img src={m.posterUrl} alt="" />}
            {isExpired ? (
              // 404=服务端已清理：显失效、不给"下载后本地播放"（那个链接也会 404），别误导成编码问题（对齐 iOS 查看器）。
              <p>{tr("media.viewer.video_expired")}</p>
            ) : (
              <>
                <p>{tr("media.viewer.video_unsupported")}</p>
                <a className="viewer-unplayable-btn" href={m.content} download>{tr("media.viewer.download_open_player")}</a>
              </>
            )}
          </div>
        ) : !videoStarted ? (
          // 封面待点：只显封面图 + 居中 ▶，点了才挂 <video>。翻页到视频＝翻到图片一样轻，无黑色控件条/无 metadata 预拉。
          <>
            <img className="image-viewer viewer-video-cover" src={m.posterUrl || m.thumb || undefined} alt={tr("chat.media.alt_video_cover")}
                 onClick={(e) => { e.stopPropagation(); onDismissMore(); onStartVideo(); }} />
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
        <img key={mediaKey} className="image-viewer" src={m.content} alt={tr("chat.media.alt_large")} onClick={(e) => { e.stopPropagation(); onDismissMore(); }}
             onError={onImageError} />
      )}
      {/* 任务3 · 左右翻页箭头：仅当前查看项在会话媒体时间线内（viewerIdx>=0）且有相邻项时显示。翻到头即停。 */}
      {viewerIdx > 0 && (
        <button className="viewer-nav prev" title={tr("media.viewer.prev")}
                onClick={(e) => { e.stopPropagation(); onNav(-1); }}><ChevronLeft size={28} /></button>
      )}
      {viewerIdx >= 0 && viewerIdx < viewerCount - 1 && (
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
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <a className="viewer-btn" href={m.content} download title={tr("common.download")}><Download size={18} /></a>
        {!fromGallery && (
          <button className="viewer-btn" title={tr("media.viewer.gallery")} onClick={onOpenGallery}><LayoutGrid size={18} /></button>
        )}
        <div className="viewer-more-wrap">
          {/* 点击切换（原 hover：鼠标从按钮移向弹窗时穿过间隙触发 onMouseLeave 即消失，够不到菜单项）。 */}
          <button className="viewer-btn" title={tr("common.more")} onClick={(e) => { e.stopPropagation(); onToggleMore(); }}><MoreHorizontal size={18} /></button>
          {more && (
            <div className="viewer-more-pop">
              <button onClick={onLocate}>{tr("media.viewer.locate")}</button>
              <button onClick={onFavorite}>{tr("common.favorite")}</button>
              <a href={m.content} download>{tr("common.download")}</a>
              {/* 视频不提供复制：无"复制字节"语义，产品上禁止复制视频消息（与 iOS 对齐）。图片才有复制。 */}
              {m.contentType !== "video" && (
                <button onClick={onCopy}>{tr("common.copy")}</button>
              )}
              <button onClick={onForward}>{tr("common.forward")}</button>
              <button className="danger" onClick={(e) => onDelete(e.clientX, e.clientY)}>{tr("common.delete")}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
