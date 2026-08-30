import { ChevronLeft, IdCard } from "lucide-react";
import { FileTypeIcon } from "../../FileTypeIcon";
import { fileNameFromContent, parseChatRecord, recordItemPreview, recordVoiceMessage, type ChatRecord } from "../../messageContent";
import { CONTACT_CONTENT_TYPE, parseContactCard } from "../../contactCard";
import { Avatar } from "../Avatar";
import { formatFileSize } from "../../fileMetadata";
import { Modal } from "../Modal";
import { VideoThumb } from "../VideoThumb";
import { VoiceBubble } from "../VoiceBubble";

/** 合并转发详情（镜像 iOS）：列出全部消息；图片/视频点击进查看器；
 *  嵌套合并转发条目 → 套娃 mini 卡片，点击入栈下钻（栈深 >1 时显返回）。
 *  纯展示：栈操作/打开查看器/子记录缓存由 App 注入。 */
export function RecordModal({ view, canGoBack, nestedAt, uid, onBack, onDrill, onOpenMedia, onOpenContact, onClose }: {
  view: ChatRecord; // 栈顶层
  canGoBack: boolean; // 栈深 > 1
  nestedAt: (index: number) => ChatRecord | undefined; // recordNested 缓存
  /** 当前登录 uid：VoiceBubble 的"已播过"集合按 uid 分桶。 */
  uid: string;
  onBack: () => void;
  onDrill: (sub: ChatRecord) => void;
  onOpenMedia: (index: number, content: string, kind: "image" | "video") => void;
  /** 名片条目 → 该人资料页（P1；与点聊天气泡同一落点）。 */
  onOpenContact: (userId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal className="modal record-modal" onClose={onClose}>
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
                <VideoThumb content={it.c} videoClass="record-item-media" onClick={() => onOpenMedia(i, it.c, "video")} />
              ) : it.ct === "file" ? (
                <a className="msg-file" href={it.c} download={it.fn || fileNameFromContent(it.c)} target="_blank" rel="noreferrer">
                  <FileTypeIcon name={it.fn || it.c} size={30} />
                  <span>{it.fn || fileNameFromContent(it.c)}</span>
                  {it.fs ? <span className="msg-file-size">{formatFileSize(it.fs)}</span> : null}
                </a>
              ) : it.ct === "voice" || it.ct === "audio" ? (
                // 语音条目 → 与详情页语音 tab / 收藏页语音行同一迷你播放器（此前落到最后的
                // .record-item-text 分支，屏幕上是一串裸 URL）。mine=false：记录是"别人说的话"视角，
                // 且 mini 变体本就不显勾与时间。
                <div className="record-item-voice">
                  <VoiceBubble m={recordVoiceMessage(it, i)} mine={false} uid={uid} audioSrc={it.c} variant="mini" />
                </div>
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
              ) : it.ct === CONTACT_CONTENT_TYPE ? (
                // 名片条目（P1 补齐；此前不可点，只显一行预览文字）：mini 卡片，点进该人资料页。
                // 脏名片解析不出 → 退化成灰字不可点，与气泡侧同口径。
                (() => {
                  const card = parseContactCard(it.c);
                  if (!card) return <div className="contact-card dirty">[个人名片]</div>;
                  return (
                    <div className="contact-card" onClick={() => onOpenContact(card.userId)}>
                      <div className="contact-card-head">
                        {/* 显示名末级不落 userId；标识行显 @句柄，没有就不渲染。 */}
                        <Avatar url={card.avatarUrl} label={card.nickname || (card.username ? `@${card.username}` : "未命名用户")} seed={card.userId} cls="avatar" />
                        <div className="contact-card-body">
                          <div className="contact-card-name">{card.nickname || (card.username ? `@${card.username}` : "未命名用户")}</div>
                          {card.username && <div className="contact-card-id">@{card.username}</div>}
                        </div>
                      </div>
                      <div className="contact-card-foot"><IdCard size={12} aria-hidden="true" />个人名片</div>
                    </div>
                  );
                })()
              ) : (
                <div className="record-item-text">{it.c}</div>
              )}
              {/* 图说条目「有字显字」：媒体/文件下方随附文本。 */}
              {it.cap && (it.ct === "image" || it.ct === "video" || it.ct === "file") ? (
                <div className="record-item-cap">{it.cap}</div>
              ) : null}
            </div>
          ))}
        </div>
        <button className="modal-close" onClick={onClose}>关闭</button>
    </Modal>
  );
}
