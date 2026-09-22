import { useEffect, useState } from "react";
import { ChevronLeft, IdCard } from "lucide-react";
import { FileTypeIcon } from "../../FileTypeIcon";
import { fileNameFromContent, parseChatRecord, recordItemPreview, recordSenderKey, recordVoiceMessage, type ChatRecord, type RecordItem } from "../../messageContent";
import { CONTACT_CONTENT_TYPE, parseContactCard } from "../../contactCard";
import { Avatar } from "../Avatar";
import { formatFileSize } from "../../fileMetadata";
import { monthDay } from "../../time";
import { Modal } from "../Modal";
import { VideoThumb } from "../VideoThumb";
import { VoiceBubble } from "../VoiceBubble";
import { useT } from "../../i18n";

/** 条目右上角的时间：`ts` 是打包端带的原消息时间。老记录没有 → 空串，整块不渲染。
 *  同一天只显 HH:mm，跨天带 M月d日（记录里常横跨多天，只显时分会看不出来）。 */
function recordItemTime(ts: number | undefined): string {
  if (!ts || ts <= 0) return "";
  const d = new Date(ts), now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? hm : `${monthDay(d)} ${hm}`;
}

/** 记录里的语音条目。**时长只有打包端带了 `d` 才有**（2026-08-30 起两端都带）——
 *  更早打包的老记录没有这个字段，只能从音频元数据里探一次；探不到就保持 0（显 0:00）。
 *  探测用一个独立的 `<audio preload="metadata">`，不碰 VoiceBubble 的模块级播放单例。 */
function RecordVoiceItem({ it, index, uid }: { it: RecordItem; index: number; uid: string }) {
  const known = it.d ?? 0;
  const [probed, setProbed] = useState(0);
  useEffect(() => {
    if (known > 0 || !it.c) return;
    const a = new Audio();
    a.preload = "metadata";
    const onMeta = () => {
      // 坏文件（如某些浏览器录出的 MP4/Opus）会报 Infinity 或荒唐的大数 → 一律丢弃，宁可不显。
      if (Number.isFinite(a.duration) && a.duration > 0 && a.duration < 24 * 3600) {
        setProbed(Math.round(a.duration * 1000));
      }
    };
    a.addEventListener("loadedmetadata", onMeta);
    a.src = it.c;
    return () => { a.removeEventListener("loadedmetadata", onMeta); a.removeAttribute("src"); };
  }, [it.c, known]);
  const m = { ...recordVoiceMessage(it, index), duration: known || probed };
  // mine=false：记录是"别人说的话"视角；mini 变体本就不显勾与时间。
  return (
    <div className="record-item-voice">
      <VoiceBubble m={m} mine={false} uid={uid} audioSrc={it.c} variant="mini" />
    </div>
  );
}

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
  const tr = useT();
  return (
    <Modal className="modal record-modal" onClose={onClose}>
        <div className="modal-title record-head">
          {canGoBack && (
            <button className="icon-btn" title={tr("common.back")} onClick={onBack}>
              <ChevronLeft size={22} />
            </button>
          )}
          <span className="record-head-title">{view.t}</span>
        </div>
        <div className="record-list">
          {view.items.map((it, i) => {
            const sameAsPrev = (k: number) => k > 0 && recordSenderKey(view.items[k - 1]) === recordSenderKey(it);
            return (
            <div key={i} className={`record-item${sameAsPrev(i) ? " continued" : ""}`}>
              {/* 头行恒在（每条都要有自己的时间），但**连续同一人只显一次头像与昵称**——
                  后续条目只留右侧时间，左侧头像列照旧占位，正文不会左右跳。 */}
              <div className="record-item-head">
                {sameAsPrev(i)
                  ? <span className="record-item-avatar-gap" />
                  : <Avatar url={it.a} label={it.n || "?"} seed={it.n || it.u} cls="avatar record-item-avatar" />}
                {!sameAsPrev(i) && <span className="record-item-name">{it.n}</span>}
                <span className="record-item-time">{recordItemTime(it.ts)}</span>
              </div>
              <div className="record-item-body">
              {it.ct === "image" ? (
                <img className="record-item-media" src={it.c} alt={tr("common.image")} onClick={() => onOpenMedia(i, it.c, "image")} />
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
                // .record-item-text 分支，屏幕上是一串裸 URL）。
                <RecordVoiceItem it={it} index={i} uid={uid} />
              ) : it.ct === "chat_record" ? (
                // 套娃 mini 卡片：标题 + 前 2 行预览 + 脚注；点击入栈进子记录（任意深度）。sub 走 nestedAt 缓存。
                (() => { const sub = nestedAt(i) ?? parseChatRecord(it.c, tr); return (
                  <div className="record-card record-card-nested" onClick={() => onDrill(sub)}>
                    <div className="record-title">{sub.t}</div>
                    <div className="record-preview">{sub.items.slice(0, 2).map((si, k) => (
                      <div key={k} className="record-line">{si.n}: {recordItemPreview(si, tr)}</div>
                    ))}</div>
                    <div className="record-foot">{tr("record.chat_history")} ›</div>
                  </div>
                ); })()
              ) : it.ct === CONTACT_CONTENT_TYPE ? (
                // 名片条目（P1 补齐；此前不可点，只显一行预览文字）：mini 卡片，点进该人资料页。
                // 脏名片解析不出 → 退化成灰字不可点，与气泡侧同口径。
                (() => {
                  const card = parseContactCard(it.c);
                  if (!card) return <div className="contact-card dirty">{tr("record.dirty_card")}</div>;
                  return (
                    <div className="contact-card" onClick={() => onOpenContact(card.userId)}>
                      <div className="contact-card-head">
                        {/* 显示名末级不落 userId；标识行显 @句柄，没有就不渲染。 */}
                        <Avatar url={card.avatarUrl} label={card.nickname || (card.username ? `@${card.username}` : tr("common.unnamed_user"))} seed={card.userId} cls="avatar" />
                        <div className="contact-card-body">
                          <div className="contact-card-name">{card.nickname || (card.username ? `@${card.username}` : tr("common.unnamed_user"))}</div>
                          {card.username && <div className="contact-card-id">@{card.username}</div>}
                        </div>
                      </div>
                      <div className="contact-card-foot"><IdCard size={12} aria-hidden="true" />{tr("contact.card.footer")}</div>
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
            </div>
          ); })}
        </div>
        <button className="modal-close" onClick={onClose}>{tr("common.close")}</button>
    </Modal>
  );
}
