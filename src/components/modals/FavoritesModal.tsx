import type { Favorite } from "../../sdk/protocol";
import { FileTypeIcon } from "../../FileTypeIcon";
import { fileNameFromContent, isUrlText } from "../../messageContent";
import { Modal } from "../Modal";
import { VideoThumb } from "../VideoThumb";

/** 收藏列表（M4-4）：内容快照 + 删除；原消息撤回/删除后仍在。
 *  纯展示：打开查看器（图/视频）经 onOpenMedia 注入，合成消息由 App 构造。 */
export function FavoritesModal({ favorites, onOpenMedia, onRemove, onClose }: {
  favorites: Favorite[];
  onOpenMedia: (fav: Favorite, kind: "image" | "video") => void;
  onRemove: (id: number) => void;
  onClose: () => void;
}) {
  return (
    <Modal className="modal fav-modal" onClose={onClose}>
        <div className="modal-title">我的收藏（{favorites.length}）</div>
        <div className="fav-list">
          {favorites.length === 0 && <div className="fwd-empty">还没有收藏</div>}
          {favorites.map((f) => (
            <div key={f.id} className="fav-item">
              <div className="fav-content">
                {f.content_type === "image" ? (
                  <img className="fav-thumb" src={f.content} alt="图片" onClick={() => onOpenMedia(f, "image")} />
                ) : f.content_type === "video" ? (
                  <VideoThumb content={f.content} videoClass="fav-thumb" onClick={() => onOpenMedia(f, "video")} />
                ) : f.content_type === "file" ? (
                  <a className="msg-file" href={f.content} download={fileNameFromContent(f.content)} target="_blank" rel="noreferrer">
                    <FileTypeIcon name={f.content} size={30} />
                    <span>{fileNameFromContent(f.content)}</span>
                  </a>
                ) : isUrlText(f.content) ? (
                  <a className="msg-link" href={f.content} target="_blank" rel="noreferrer">{f.content}</a>
                ) : (
                  f.content
                )}
                {/* 图说整体收藏：媒体/文件快照下方显随附文字（老收藏无 caption 键不占位）。 */}
                {f.caption && <div className="fav-caption">{f.caption}</div>}
              </div>
              <button className="fav-del" title="删除收藏" onClick={() => onRemove(f.id)}>✕</button>
            </div>
          ))}
        </div>
        <button className="modal-close" onClick={onClose}>关闭</button>
    </Modal>
  );
}
