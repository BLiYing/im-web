// MessageBubble：聊天页「一条普通消息」的气泡单元（文本 / 图片 / 视频 / 语音 / 文件 / 名片 / 合并转发 / 通话 / 链接卡 / 引用条 / 图说 /
// 时间·勾 / 翻译 / 语音转写）+ 群聊对方的头像·昵称列（SenderColumn）。从 MessageList 平移（JSX 逐字搬，行为保持），
// 供聊天页与置顶面板（PINNED_PANEL_DESIGN §2.2「与聊天页同源渲染」）共用。
// - `readOnly`（置顶面板）：内容不可交互——图片/视频不开查看器、语音不播放、链接/@/名片/文件/引用条不响应、文件不画下载环，
//   不画已读勾/发送状态/失败❗/翻译/转写；文本最多 8 行。右键/长按仍可用（`onMenu` 覆盖默认的聊天页菜单）。
// - 系统行 / 撤回墓碑 / 相册宫格 / 群聊通话系统条仍在 MessageList（它们不是「一个气泡」）。
import { bubbleLayoutClass } from "../bubbleLayout";
import type { MouseEvent, ReactNode } from "react";
import { useT, useLang } from "../i18n";
import type { ChatMessage } from "../sdk/protocol";
import { buildSysNoticeText, localizeReplySnapshot } from "../sysEventRender";
import { chunkedTaskFor } from "../sdk/chunkedUpload";
import { formatTime, type TimeFormat } from "../time";
import { FileTypeIcon } from "../FileTypeIcon";
import { formatFileSize } from "../fileMetadata";
import { formatMediaDuration, formatUploadProgress } from "../media";
import { downloadGlyph, downloadText, type DownloadState, type MediaKind } from "../download";
import { isUrlText, parseChatRecord, recordItemPreview, fileNameFromContent, mediaBoxProps, isPreviewableFile, videoFrameSrc, firstURLInText } from "../messageContent";
import { IdCard } from "lucide-react";
import { CONTACT_CONTENT_TYPE, parseContactCard } from "../contactCard";
import { CALL_CONTENT_TYPE, renderCallRecord } from "../callRecord";
import { placeSingleCall } from "../rtc/rtcCall";
import { ExpiredCover } from "./ExpiredCover";
import { CallRecordBody } from "./CallRecordBubble";
import { Avatar } from "./Avatar";
import { QuoteThumb, QuoteSnapshotIcon } from "./QuoteThumb";
import { FileGateIcon } from "./FileGateIcon";
import { LinkCard } from "./LinkCard";
import { VoiceBubble } from "./VoiceBubble";
import { useChatActions } from "../ChatActionsContext"; import { resendPolicyFor } from "../resendPolicy";
import { VideoFrame } from "./VideoFrame"; import { ReadTick } from "./ReadTick";

/** 气泡渲染依赖的 App 内闭包（随 groupInfos/dlBlobs/搜索态等变化，不能进 context）。聊天页与置顶面板传同一份。 */
export interface BubbleEnv {
  mediaGate: (m: ChatMessage) => DownloadState | undefined;
  mediaSrc: (m: ChatMessage) => string;
  senderLabel: (m: ChatMessage) => string;
  /** 某人在本机的显示名（备注 > 群昵称/昵称 > fallback > uid）：系统消息名字、引用条发送者共用。 */
  localNameOf: (uid: string, convId: string, fallback?: string) => string;
  senderRole: (m: ChatMessage) => "owner" | "admin" | undefined;
  senderAvatar: (m: ChatMessage) => string | undefined;
  renderMentionText: (m: ChatMessage, text: string) => ReactNode;
  renderMessageText: (m: ChatMessage) => ReactNode;
  openPeerDetail: (uid: string) => void;
  handleScanRaw: (raw: string) => Promise<void>;
}

export interface MessageBubbleProps extends BubbleEnv {
  m: ChatMessage;
  /** 引用条找原消息用（聊天页 = 当前窗口；置顶面板 = 本地全量）。 */
  messages: readonly ChatMessage[];
  peer: string;
  isGroupChat: boolean;
  isSuperGroup?: boolean;
  uid: string;
  readSeq: number;
  timeFormat: TimeFormat;
  selectMode: boolean;
  /** 右键/长按菜单正作用于本条 → 稳态高亮。 */
  menuActive: boolean;
  translations?: Record<number, string>;
  transcripts?: Record<number, string>;
  uploadProgress: Record<string, { sent: number; total: number }>;
  readOnly?: boolean;
  /** 覆盖默认右键/长按（聊天页 = setMenu 打开 .ctx-menu）。置顶面板传自己的过滤菜单。 */
  onMenu?: (e: MouseEvent, m: ChatMessage) => void;
}

/** 群聊对方消息的左侧头像列 + 气泡上方昵称（含群主/管理员徽章）。聊天页按连续段决定显不显；置顶面板每条都显。 */
export function SenderColumn({ m, showAvatar, showSender, env, readOnly, children }: {
  m: ChatMessage; showAvatar: boolean; showSender: boolean; readOnly?: boolean; children: ReactNode;
  env: Pick<BubbleEnv, "senderLabel" | "senderRole" | "senderAvatar" | "openPeerDetail">;
}) {
  const tr = useT();
  const role = env.senderRole(m);
  return (
    <div className="them-wrap">
      <div className="avatar-col">
        {showAvatar && <Avatar cls="avatar bubble-avatar" url={env.senderAvatar(m)} label={env.senderLabel(m)} seed={m.from} onClick={readOnly ? undefined : () => env.openPeerDetail(m.from)} />}
      </div>
      <div className="them-stack">
        {showSender && (
          <span className="sender-row">
            <span className="sender-name">{env.senderLabel(m)}</span>
            {role === "owner" && <span className="role-badge owner">{tr("group.role.owner")}</span>}
            {role === "admin" && <span className="role-badge">{tr("group.role.admin")}</span>}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

export function MessageBubble(p: MessageBubbleProps) {
  const tr = useT();
  const lang = useLang();
  const {
    m, messages, peer, isGroupChat, isSuperGroup, uid, readSeq, timeFormat, selectMode, menuActive, translations, transcripts, uploadProgress,
    mediaGate, mediaSrc, localNameOf, renderMentionText, renderMessageText, openPeerDetail, handleScanRaw,
  } = p;
  const ro = !!p.readOnly;
  const {
    setMenu, setViewer, setRecordStack, setToast, locateInChat,
    onGateTap, onMediaBubbleTap, openReadyFile, onPassiveMediaError, retryUpload, resendMessage, toggleUploadPause,
    fetchLinkPreview, onMediaLoad, pendingFilesRef,
  } = useChatActions();
  const mine = m.from === uid;
  const readByPeer = mine && m.convSeq > 0 && m.convSeq <= readSeq;
  // 大群里单勾恒为"已送达"、永远变不成双勾，且超级群已明说关闭已读状态——整条隐藏，与 iOS 同口径。只读面板一律不画勾。
  const showTick = mine && m.convSeq > 0 && !isSuperGroup && !ro;
  const callView = m.contentType === CALL_CONTENT_TYPE
    ? renderCallRecord(m.content, { viewerIsSender: mine, isGroup: isGroupChat,
        senderName: mine ? undefined : localNameOf(m.from, m.convId, m.fromNickname) }, tr)
    : null;
  // 媒体气泡：时间/已读压在图上（右下角），故不再渲染气泡下方的 .bmeta 行。
  const isMediaBubble = m.contentType === "image" || m.contentType === "video";
  // voice 内部 VoiceBubble 自带 meta（时长·HH:mm·已读勾），外层 bmeta 再画一遍就会双时间叠印（2026-08-27 修）。
  const isVoiceBubble = m.contentType === "voice";
  // 卡片型气泡（名片 / 合并转发，与 iOS 一致卡片本身就是气泡）：外层气泡不画底色、时间嵌进卡片脚注行。
  const isCardBubble = m.contentType === CONTACT_CONTENT_TYPE || m.contentType === "chat_record";
  // 时间 + 勾的内容抽一份：普通气泡放在下方 .bmeta 里，卡片气泡嵌进卡片脚注行（两处各写一遍迟早漂移）。
  const metaNode = (
    <span className="bmeta">
      {m.editedAt ? <span className="edited-tag">{tr("chat.message.edited")} </span> : null}
      {mine && !ro ? (
        m.status === "sending" ? tr("common.sending") : m.status === "failed" ? (m.note ? null : <span className="failed">{tr("chat.message.send_failed_mark")}</span>)
            : <>{formatTime(m.timestamp, timeFormat)}{showTick ? <ReadTick read={readByPeer} className="ck" /> : null}</>
      ) : (
        formatTime(m.timestamp, timeFormat)
      )}
    </span>
  );
  const uploading = ro ? undefined : uploadProgress[m.clientMsgId ?? ""];
  // 暂停态唯一真相=分片任务（toggleUploadPause bump 进度对象触发重渲染）；小文件无任务恒 false。
  const uploadPaused = !!chunkedTaskFor(m.clientMsgId ?? "")?.paused;
  const durationText = m.contentType === "video" ? formatMediaDuration(m.duration) : "";
  // 下载门控（M4-7）：undefined=就绪；非空=未下载/下载中/失败/已失效 → 卡片显 ↓ 或进度，不加载原件（只读面板同样不越过门控拉原件）。
  const gate = mediaGate(m);
  // 红❗可不可点 = 这条能不能重发（被拒收/已送达的不给入口，判据与 iOS 同一套）。
  const canResend = resendPolicyFor(m, mine) !== "none";
  const onMenu = (e: MouseEvent) => {
    if (selectMode) return;
    e.preventDefault();
    if (p.onMenu) p.onMenu(e, m); else setMenu({ x: e.clientX, y: e.clientY, m });
  };
  const fileName = m.fileName || fileNameFromContent(m.content);
  return (
    <>
      <div className="bubble-line">
        {!ro && mine && m.status === "failed" && (
          <button type="button" className="fail-badge" disabled={!canResend}
                  title={m.note || (canResend ? tr("chat.message.send_failed_resend") : tr("common.send_failed"))}
                  onClick={() => resendMessage(m)}>!</button>
        )}
        <div className={`bubble${isMediaBubble ? " media" : ""}${isCardBubble ? " card" : ""}${callView ? " call-bubble" : ""}${callView ? "" : bubbleLayoutClass(m.contentType)}${menuActive ? " ctx-active" : ""}${ro ? " readonly" : ""}`}
          onClick={callView && !selectMode && !ro ? () => { if (!placeSingleCall(peer, callView.icon === "video")) setToast(tr("chat.message.call_unavailable")); } : undefined}
          onContextMenu={onMenu}>
          {/* 转发消息按普通消息显示（隐私保护）：不再渲染"转发自 X"。forwardFrom 仍随消息保留，供再次转发保留最初作者链路，但不外显（与 iOS 拉齐）。 */}
          {m.replyToConvSeq ? (
            // 引用条：媒体内嵌小缩略图；群聊两行式——被引用者昵称（accent）+ 内容预览（M4-x，单聊不显示发送者）。
            <div className="quote-bar" onClick={ro ? undefined : () => locateInChat(m.convId, m.replyToConvSeq!)}>
              {(() => { const q = messages.find((x) => x.convSeq === m.replyToConvSeq);
                // 图说消息（带 caption）：引用**只显文本**（快照即 caption），不挂媒体缩略图——简化、少出错。
                if (q?.caption) return null;
                // 原消息在本地 → 真帧/磨砂/图标由 QuoteThumb 定；不在本地 → 从快照文本推兜底图标（与 iOS 一致，别只剩文本）。
                return q ? <QuoteThumb m={q} gated={!!mediaGate(q)} /> : <QuoteSnapshotIcon snapshot={m.replySnapshot} />; })()}
              <span className="quote-lines">
                {isGroupChat && m.replyToFrom && (
                  <span className="quote-who">{m.replyToFrom === uid ? tr("common.you") : localNameOf(m.replyToFrom, m.convId, m.replyToFrom)}</span>
                )}
                <span className="quote-text">{localizeReplySnapshot(m, tr) || tr("chat.quote.original_fallback")}</span>
              </span>
            </div>
          ) : null}
          {isMediaBubble ? (
            // 图片/视频：按 media_w/media_h 的原始比例定框（未知回退方块），左上角时长或上传进度、右下角时间+已读态、
            // 视频居中播放角标——与 iOS 同版式。点按走状态机（失败 ↻ 重试 / 上传中 ⏸↔↑ / 其余打开查看器）；只读不响应。
            <span {...mediaBoxProps(m)}
                  onClick={ro ? undefined : () => (gate ? onGateTap(m) : onMediaBubbleTap(m, () => setViewer({ m })))}
                  title={gate && !ro ? downloadText(gate, formatFileSize(m.fileSize)) : undefined}>
              {/* 门控（未下载）：不拉原图/原视频，只显 thumb 模糊占位（~200B data URI），没有就留灰底。 */}
              {gate
                ? (m.thumb
                    ? <img className="msg-image msg-image-blur" src={m.thumb} alt={tr("fav.file.not_downloaded")} />
                    : <span className="msg-image msg-image-empty" />)
                : m.contentType === "video"
                  ? (m.posterUrl
                      ? <img className="msg-image" src={m.posterUrl} alt={tr("common.video")} onLoad={onMediaLoad} onError={() => void onPassiveMediaError(m)} />
                      : <VideoFrame className="msg-image" src={videoFrameSrc(mediaSrc(m))} thumb={m.thumb} thumbClass="msg-image msg-image-blur" emptyClass="msg-image msg-image-empty" onLoadedData={onMediaLoad} onError={() => void onPassiveMediaError(m)} />)
                  : <img className="msg-image" src={mediaSrc(m)} alt={tr("common.image")} onLoad={onMediaLoad} onError={() => void onPassiveMediaError(m)} />}
              {gate
                ? (gate.phase === "expired" ? <ExpiredCover caption={downloadText(gate, "", m.contentType as MediaKind)} />
                    : !ro && downloadGlyph(gate) && <span className="play-badge">{downloadGlyph(gate)}</span>)
                : uploading
                ? (chunkedTaskFor(m.clientMsgId ?? "") && <span className="play-badge">{uploadPaused ? "↑" : "⏸"}</span>)
                : (!ro && mine && m.status === "failed" && m.convSeq === 0 && pendingFilesRef.current.has(m.clientMsgId ?? ""))
                  ? <span className="play-badge">↻</span>
                  : m.contentType === "video" && <span className="play-badge">▶</span>}
              {gate && !ro
                ? (gate.phase !== "expired" && <span className="media-badge media-badge-tl">
                    {/* 未下载=「大小 · 时长」（大小在前，与宫格/iOS 统一）；下载中/暂停/失败=只显状态，藏时长（省空间、防溢出）。 */}
                    {downloadText(gate, formatFileSize(m.fileSize), m.contentType as MediaKind)}{gate.phase === "notStarted" && durationText ? ` · ${durationText}` : ""}
                  </span>)
                : uploading
                ? <span className="media-badge media-badge-tl">{uploadPaused ? "⏸ " : ""}{formatUploadProgress(uploading.sent, uploading.total)}</span>
                : (durationText && gate?.phase !== "expired" && <span className="media-badge media-badge-tl">{durationText}</span>)}
              <span className="media-badge media-badge-br">
                {mine && !ro
                  // 只有真正在传输才显「发送中…」；暂停时回落显示时间（与 iOS 一致）。
                  ? (m.status === "sending" ? (uploadPaused ? formatTime(m.timestamp, timeFormat) : tr("common.sending"))
                    // 被拒收（有 note）时失败已由红❗+下方系统行表达，角标只显时间，不重复报错（与 iOS 一致）。
                    : m.status === "failed" ? (m.note ? formatTime(m.timestamp, timeFormat) : tr("chat.message.not_sent_mark"))
                    : <>{formatTime(m.timestamp, timeFormat)}{showTick ? <ReadTick read={readByPeer} className="ck" /> : null}</>)
                  : formatTime(m.timestamp, timeFormat)}
              </span>
            </span>
          ) : m.contentType === "chat_record" ? (
            // 合并转发卡片（镜像 iOS）：标题 + 前几条预览 + 脚注，点击进详情。脚注行 = 左「聊天记录」+ 右「时间/勾」（iOS IMChatRecordCell 同布局）。
            (() => { const r = parseChatRecord(m.content, tr); return (
              <div className="record-card" onClick={ro ? undefined : () => setRecordStack([r])}>
                <div className="record-title">{r.t}</div>
                <div className="record-preview">{r.items.slice(0, 4).map((it, i) => (
                  <div key={i} className="record-line">{it.n}: {recordItemPreview(it, tr)}</div>
                ))}</div>
                <div className="record-foot">
                  <span>{tr("record.chat_history")}</span>
                  {metaNode}
                </div>
              </div>
            ); })()
          ) : m.contentType === CONTACT_CONTENT_TYPE ? (
            // 个人名片卡片（镜像 iOS IMContactCardCell）：头像 + 显示名 + ID + 脚注，点击进对方资料页（openPeerDetail）。
            (() => {
              const card = parseContactCard(m.content);
              // 脏名片（JSON 非法 / 缺 u）：退化成一行灰字、不可点——历史里不留点不动的死卡。
              if (!card) return <div className="contact-card dirty">{tr("record.dirty_card")}</div>;
              // 主标题走**收方本地**显示名（备注优先），与会话/详情页同源，不会一处备注一处昵称。
              const shown = localNameOf(card.userId, m.convId, card.nickname);
              return (
                <div className="contact-card" onClick={ro ? undefined : () => openPeerDetail(card.userId)}>
                  <div className="contact-card-head">
                    <Avatar url={card.avatarUrl} label={shown} seed={card.userId} cls="avatar" />
                    <div className="contact-card-body">
                      <div className="contact-card-name">{shown}</div>
                      {/* @句柄而非内部 ID（10 位随机数字）。老消息无 un → 该行不渲染。 */}
                      {card.username && <div className="contact-card-id">@{card.username}</div>}
                    </div>
                  </div>
                  {/* 脚注行 = 左「个人名片」+ 右「时间/勾」，与 iOS IMContactCardView 同布局。 */}
                  <div className="contact-card-foot">
                    <span className="contact-card-foot-label"><IdCard size={12} aria-hidden="true" />{tr("contact.card.footer")}</span>
                    {metaNode}
                  </div>
                </div>
              );
            })()
          ) : callView ? (
            <CallRecordBody view={callView} />
          ) : m.contentType === "voice" ? (
            // 语音气泡（P0，Web 只播不录，见 IMServer docs/VOICE_MESSAGE_DESIGN §10）：▶ + 波形 + m:ss + 未播红点；单例 audio 同页面一次只播一条。
            // 只读：外层 .bubble.readonly 截掉指针事件，置顶面板行再在捕获阶段吞掉点击（PinnedListModal），不会触发播放。
            <VoiceBubble m={m} mine={mine} uid={uid} audioSrc={mediaSrc(m)} showTick={showTick}
                         readByPeer={readByPeer} timeFormat={timeFormat} />
          ) : m.contentType === "file" ? (
            // 只读：恒按「就绪」外观画（图标 + 名 + 大小），不画下载环/进度、不响应点击。
            ro ? (
              <span className="msg-file">
                <FileTypeIcon name={fileName} size={30} />
                <span className="msg-file-body">
                  <span className="msg-file-name">{fileName || tr("common.file")}</span>
                  {formatFileSize(m.fileSize) && <span className="msg-file-size">{formatFileSize(m.fileSize)}</span>}
                </span>
              </span>
            )
            // 上传中（content 还没有 URL）不渲染成可点下载的 <a>，改显进度条 + 已传/总大小。
            : uploading || !m.content ? (
              <span className={`msg-file${m.status === "failed" ? " failed" : ""}`}
                    onClick={m.status === "failed" ? () => retryUpload(m)
                           : uploading ? () => toggleUploadPause(m) : undefined}>
                <FileTypeIcon name={m.fileName || ""} size={30} />
                <span className="msg-file-body">
                  <span className="msg-file-name">{m.fileName || tr("common.file")}</span>
                  <span className="msg-file-size">
                    {m.status === "failed" ? tr("chat.file.upload_failed_retry", { size: formatFileSize(m.fileSize) })
                      : uploading
                        ? `${formatUploadProgress(uploading.sent, uploading.total)}${
                            chunkedTaskFor(m.clientMsgId ?? "") ? ` · ${uploadPaused ? tr("chat.file.paused_tap_resume") : tr("chat.file.tap_pause")}` : ""}`
                        : formatFileSize(m.fileSize)}
                  </span>
                  {/* 失败态不显进度条：0% 的空条会让人以为"还没开始传"。 */}
                  {m.status !== "failed" && (
                    <span className="file-progress">
                      <span className="file-progress-bar"
                            style={{ width: `${uploading && uploading.total > 0 ? Math.round((uploading.sent / uploading.total) * 100) : 0}%` }} />
                    </span>
                  )}
                </span>
              </span>
            ) : gate ? (
              // 门控（M4-7）：未下载/下载中/失败——圆形图标位即状态位（↓ / 环形进度 / ↻），点击就地下载，不跳页。
              <span className={`msg-file${gate.phase === "failed" || gate.phase === "expired" ? " failed" : ""}`}
                    onClick={() => onGateTap(m)}
                    title={gate.phase === "expired" ? tr("chat.file.expired") : tr("media.download.tap_to_download")}>
                <FileGateIcon state={gate} />
                <span className="msg-file-body">
                  <span className="msg-file-name">{fileName}</span>
                  <span className="msg-file-size">
                    {gate.phase === "notStarted"
                      ? (formatFileSize(m.fileSize) ? tr("chat.file.size_tap_download", { size: formatFileSize(m.fileSize) }) : tr("media.download.tap_to_download"))
                      : downloadText(gate, formatFileSize(m.fileSize))}
                  </span>
                </span>
              </span>
            ) : (
              // 就绪：点击路由（可预览类型新标签预览 / 其余另存，对齐 iOS QuickLook）。已手动下过走应用内 blob。
              <span className="msg-file clickable" onClick={() => openReadyFile(m)}
                    title={isPreviewableFile(fileName) ? tr("chat.file.tap_preview") : tr("media.download.tap_to_download")}>
                <FileTypeIcon name={fileName} size={30} />
                <span className="msg-file-body">
                  <span className="msg-file-name">{fileName}</span>
                  {formatFileSize(m.fileSize) && <span className="msg-file-size">{formatFileSize(m.fileSize)}</span>}
                </span>
              </span>
            )
          ) : isUrlText(m.content) ? (
            // 纯 URL 消息：可点击 URL 文本 + 下方 OG 富预览卡片（引用/普通消息一致）。
            <LinkCard url={m.content} fetchPreview={fetchLinkPreview} onMediaLoad={onMediaLoad}
                      onOpenInvite={(u) => void handleScanRaw(u)} />
          ) : m.sysEvent && buildSysNoticeText(m, tr, lang) !== undefined ? (
            <span className="btext">{buildSysNoticeText(m, tr, lang)}</span> // 系统通知单聊（P3）：无 sysSegments，本地拼多行文本，仍走普通文本气泡
          ) : (
            // 文本气泡：正文（含 URL 高亮 <a>）+ 若首个 URL 存在则挂 preview 卡（cardOnly=不再重复 URL 文本行）。
            // 抓不到 og 时 LinkCard 内部返回 null 静默隐藏（负缓存），只留正文里的高亮 —— 与 iOS 一致。
            // 只读（置顶面板）：不走长文本三档（卡片/折叠/展开都要点），直接最多 8 行省略（DESIGN §2.2）。
            <>
              {ro ? <span className="btext pinned-clamp">{renderMentionText(m, m.content)}</span> : renderMessageText(m)}
              {(() => {
                const u = firstURLInText(m.content);
                return u ? <LinkCard url={u} cardOnly fetchPreview={fetchLinkPreview} onMediaLoad={onMediaLoad}
                                    onOpenInvite={(u2) => void handleScanRaw(u2)} /> : null;
              })()}
            </>
          )}
          {/* 图说 caption（Telegram 模型）：图文/视频文/文件文的随附文本，渲染在媒体/文件卡下方、同一气泡内。
              媒体气泡时间压在图上（media-badge-br），故 caption 只出纯文字；文件气泡时间仍在下方 bmeta。 */}
          {m.caption && (m.contentType === "image" || m.contentType === "video" || m.contentType === "file") ? (
            <div className={`msg-caption${m.contentType === "file" ? " file" : ""}`}>{renderMentionText(m, m.caption)}</div>
          ) : null}
          {!isMediaBubble && !isVoiceBubble && !isCardBubble && (
            metaNode
          )}
        </div>
      </div>
      {!ro && m.convSeq > 0 && translations?.[m.convSeq] && (
        <div className="translation"><span>{translations[m.convSeq]}</span></div>
      )}
      {/* 语音转写面板（服务端识别）：空串=识别中。左侧引用线 + 文本 + 尾行隐私说明，与 iOS 同视觉语系。 */}
      {!ro && m.convSeq > 0 && transcripts?.[m.convSeq] !== undefined && (
        <div className={`voice-transcript${mine ? " mine" : ""}`}>
          <span className="voice-transcript-text">
            {transcripts[m.convSeq] || tr("chat.voice.transcribing")}
          </span>
          {transcripts[m.convSeq] && (
            <span className="voice-transcript-foot">{tr("chat.voice.transcript_note")}</span>
          )}
        </div>
      )}
    </>
  );
}
