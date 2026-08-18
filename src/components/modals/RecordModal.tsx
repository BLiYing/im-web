import { ChevronLeft } from "lucide-react";
import { FileTypeIcon } from "../../FileTypeIcon";
import { fileNameFromContent, parseChatRecord, recordItemPreview, videoFrameSrc, type ChatRecord } from "../../messageContent";
import { formatFileSize } from "../../fileMetadata";

/** 合并转发详情（镜像 iOS）：列出全部消息；图片/视频点击进查看器；
 *  嵌套合并转发条目 → 套娃 mini 卡片，点击入栈下钻（栈深 >1 时显返回）。
 *  纯展示：栈操作/打开查看器/子记录缓存由 App 注入。 */
export function RecordModal({ view, canGoBack, nestedAt, onBack, onDrill, onOpenMedia, onClose }: {
  view: ChatRecord; // 栈顶层
  canGoBack: boolean; // 栈深 > 1
  nestedAt: (index: number) => ChatRecord | undefined; // recordNested 缓存
  onBack: () => void;
  onDrill: (sub: ChatRecord) => void;
  onOpenMedia: (index: number, content: string, kind: "image" | "video") => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal record-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title record-head">
          {canGoBack && (
            <button className="icon-btn" title="返回" onClick={onBack}>
              <ChevronLeft size={22} />
            </button>
          )}
          <span className="record-head-title">{view.t}</span>
        </div>
        <div className="record-list">
          {view.items.map((it, i) => (
            <div key={i} className="record-item">
              <div className="record-item-name">{it.n}</div>
              {it.ct === "image" ? (
                <img className="record-item-media" src={it.c} alt="图片" onClick={() => onOpenMedia(i, it.c, "image")} />
              ) : it.ct === "video" ? (
                <span className="fav-thumb-wrap" onClick={() => onOpenMedia(i, it.c, "video")}>
                  <video className="record-item-media" src={videoFrameSrc(it.c)} preload="metadata" muted /><span className="play-badge">▶</span>
                </span>
              ) : it.ct === "file" ? (
                <a className="msg-file" href={it.c} download={it.fn || fileNameFromContent(it.c)} target="_blank" rel="noreferrer">
                  <FileTypeIcon name={it.fn || it.c} size={30} />
                  <span>{it.fn || fileNameFromContent(it.c)}</span>
                  {it.fs ? <span className="msg-file-size">{formatFileSize(it.fs)}</span> : null}
                </a>
              ) : it.ct === "chat_record" ? (
                // 套娃 mini 卡片：标题 + 前 2 行预览 + 脚注；点击入栈进子记录（任意深度）。sub 走 nestedAt 缓存。
                (() => { const sub = nestedAt(i) ?? parseChatRecord(it.c); return (
                  <div className="record-card record-card-nested" onClick={() => onDrill(sub)}>
                    <div className="record-title">{sub.t}</div>
                    <div className="record-preview">{sub.items.slice(0, 2).map((si, k) => (
                      <div key={k} className="record-line">{si.n}: {recordItemPreview(si)}</div>
                    ))}</div>
                    <div className="record-foot">聊天记录 ›</div>
                  </div>
                ); })()
              ) : (
                <div className="record-item-text">{it.c}</div>
              )}
            </div>
          ))}
        </div>
        <button className="modal-close" onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}
