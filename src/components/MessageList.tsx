// MessageList：聊天消息流的逐行渲染（系统行/撤回墓碑/相册宫格/文本·图片·视频·文件·合并转发气泡/引用条/图说/
// 状态标记/多选勾选）。从 App.tsx 平移（阶段 1，行为保持型：JSX 逐字搬，CODING_STYLE §7）。
// - **稳定动作**从 ChatActionsContext 取（setMenu/setViewer/onGateTap/...，App 侧 useMemo 一次）；
// - **reactive 值与 App 内闭包**（messages/selectMode/mediaGate/senderLabel/renderMessageText/...）走 props；
// - `.msgs` 滚动容器与 onScroll 仍留在 App（滚动核心互咬 ref，§7 明确缓拆），本组件只出行。
// 护栏：App.messageList.test.tsx（15 例）+ App.smoke.test.tsx。
import { Fragment, useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { ChatMessage } from "../sdk/protocol";
import { pickNextVoiceRelay, voiceRelayMid } from "../voiceRelay";
import { chunkedTaskFor } from "../sdk/chunkedUpload";
import { albumMembers, isAlbumLeader, isAlbumMember, msgKey } from "../album";
import { formatTime, isSameDay, dayHeader, type TimeFormat } from "../time";
import { FileTypeIcon } from "../FileTypeIcon";
import { formatFileSize } from "../fileMetadata";
import { formatMediaDuration, formatUploadProgress } from "../media";
import { downloadGlyph, downloadText, type DownloadState, type MediaKind } from "../download";
import {
  isUrlText, localizeSnippet, selectableInMultiSelect, parseChatRecord, recordItemPreview,
  fileNameFromContent, mediaBoxProps, isPreviewableFile, videoFrameSrc, firstURLInText,
} from "../messageContent";
import { IdCard } from "lucide-react";
import { CONTACT_CONTENT_TYPE, parseContactCard } from "../contactCard";
import { Avatar } from "./Avatar";
import { AlbumGrid } from "./AlbumGrid";
import { QuoteThumb, QuoteSnapshotIcon } from "./QuoteThumb";
import { FileGateIcon } from "./FileGateIcon";
import { LinkCard } from "./LinkCard";
import { VoiceBubble, setVoiceRelayResolver, voicePlayedSet } from "./VoiceBubble";
import { useChatActions } from "../ChatActionsContext";

export interface MessageListProps {
  messages: ChatMessage[];
  peer: string;
  isGroupChat: boolean;
  uid: string;
  selectMode: boolean;
  selected: Set<number>;
  menu: { m: ChatMessage } | null;
  readSeq: number;
  firstUnreadIdx: number;
  timeFormat: TimeFormat;
  translations: Record<number, string>;
  /** convSeq -> 语音转写文本；空串=识别中，undefined=未展开。 */
  transcripts?: Record<number, string>;
  uploadProgress: Record<string, { sent: number; total: number }>;
  dividerRef: RefObject<HTMLDivElement>;
  // App 内闭包（随 groupInfos/dlBlobs/搜索态等变化，不能进 context）
  mediaGate: (m: ChatMessage) => DownloadState | undefined;
  mediaSrc: (m: ChatMessage) => string;
  senderLabel: (m: ChatMessage) => string;
  /** 某人在本机的显示名（备注 > 群昵称/昵称 > fallback > uid）：系统消息名字、引用条发送者共用。 */
  localNameOf: (uid: string, convId: string, fallback?: string) => string;
  senderRole: (m: ChatMessage) => "owner" | "admin" | undefined;
  senderAvatar: (m: ChatMessage) => string | undefined;
  renderMentionText: (m: ChatMessage, text: string) => ReactNode;
  renderMessageText: (m: ChatMessage) => ReactNode;
  // 定义在 App 的 login 早退之后（不能进 useMemo 化 context，否则 TDZ）
  openPeerDetail: (uid: string) => void;
  handleScanRaw: (raw: string) => Promise<void>;
  requestFriendFromNote: (target: string) => Promise<void>;
}

export function MessageList(p: MessageListProps) {
  const {
    messages, peer, isGroupChat, uid, selectMode, selected, menu, readSeq, firstUnreadIdx,
    timeFormat, translations, transcripts, uploadProgress, dividerRef,
    mediaGate, mediaSrc, senderLabel, localNameOf, senderRole, senderAvatar, renderMentionText, renderMessageText,
    openPeerDetail, handleScanRaw, requestFriendFromNote,
  } = p;
  const {
    setMenu, setViewer, setInput, setRecordStack, setToast, locateInChat,
    onGateTap, onMediaBubbleTap, openReadyFile, onPassiveMediaError, retryUpload, toggleUploadPause,
    toggleSelected, fetchLinkPreview, onMediaLoad, pendingFilesRef,
  } = useChatActions();
  // 语音接力连播（§6.4，对齐 iOS）：把"下一条该播谁"的数据源注入 VoiceBubble 的模块级单例 audio。
  // 规则本身在 pickNextVoiceRelay（纯函数，voice.test.ts 护栏）；这里只负责 finishedMid→索引 的定位
  // 与 src 拼装。卸载（切会话）即注销 → 接力自然停在本会话内。
  //
  // 注册**只在挂载时做一次**，实时数据经 ref 取：messages 每次渲染都是新数组（App 里 slice().sort()），
  // 挂依赖数组会导致每次渲染重注册，且让模块级全局长期钉住整份消息数组与 mediaSrc（闭包含 blob 表）。
  const relayEnv = useRef({ messages, uid, mediaSrc });
  relayEnv.current = { messages, uid, mediaSrc };
  useEffect(() => {
    setVoiceRelayResolver((finishedMid) => {
      const { messages: msgs, uid: myUid, mediaSrc: srcOf } = relayEnv.current;
      const idx = msgs.findIndex((m) => m.contentType === "voice" && voiceRelayMid(m) === finishedMid);
      if (idx < 0) return null;
      // 已播集合按 (uid, 会话) 取一次即可：扫描期间不会变，逐条查会把整串 JSON 重复 parse N 遍。
      const played = voicePlayedSet(myUid, msgs[idx].convId);
      const next = pickNextVoiceRelay(msgs, idx, myUid, (_convId, mid) => played.has(mid));
      if (!next) return null;
      const src = srcOf(next);
      return src ? { mid: voiceRelayMid(next), src, convId: next.convId } : null;
    });
    return () => setVoiceRelayResolver(null);
  }, []);

  // 相册左侧框=整组全选/全不选：全在→把在的逐个翻掉、否则把不在的逐个翻上（复用 toggleSelected，全有/全无语义）。
  const toggleAlbumGroup = (seqs: number[]) => {
    const allIn = seqs.length > 0 && seqs.every((s) => selected.has(s));
    seqs.forEach((s) => { if (allIn ? selected.has(s) : !selected.has(s)) toggleSelected(s); });
  };

  // 两条消息是否属于同一「连续段」：同发送者、非系统/撤回、同一天（跨天有日期分隔断段）。
  const sameSenderRun = (a?: ChatMessage, b?: ChatMessage): boolean =>
    !!a && !!b && a.from === b.from && a.from !== uid &&
    a.contentType !== "system" && b.contentType !== "system" &&
    !a.recalledAt && !b.recalledAt && isSameDay(a.timestamp, b.timestamp);
  // 上/下一「可见消息」（跳过相册零高从行）——用于连续段首/末判定。多选态相册同样聚簇（整组一个勾选单位），故两态都跳从行。
  const prevVisibleMsg = (list: ChatMessage[], i: number): ChatMessage | undefined => {
    for (let j = i - 1; j >= 0; j--) {
      if (isAlbumMember(list[j]) && !isAlbumLeader(list, j)) continue;
      return list[j];
    }
    return undefined;
  };
  const nextVisibleMsg = (list: ChatMessage[], i: number): ChatMessage | undefined => {
    for (let j = i + 1; j < list.length; j++) {
      if (isAlbumMember(list[j]) && !isAlbumLeader(list, j)) continue;
      return list[j];
    }
    return undefined;
  };

  return (
    <>
      {messages.map((m, i) => {
        const mine = m.from === uid;
        const readByPeer = mine && m.convSeq > 0 && m.convSeq <= readSeq;
        const showDate = m.timestamp > 0 && (i === 0 || !isSameDay(m.timestamp, messages[i - 1].timestamp));
        // Telegram 式连续消息分组（群聊对方）：连续同发送者只首条显名、末条显头像；非首条收紧上间距。
        const grpThem = isGroupChat && !mine;
        const showSender = grpThem && !sameSenderRun(prevVisibleMsg(messages, i), m);
        const showAvatar = grpThem && !sameSenderRun(m, nextVisibleMsg(messages, i));
        const grouped = grpThem && sameSenderRun(prevVisibleMsg(messages, i), m);
        // 系统消息（群邀请/移除/转让/禁言等留痕）：居中灰字，无气泡/勾/菜单。
        if (m.contentType === "system") {
          return (
            <div className="msg-item" data-seq={m.convSeq} key={msgKey(m)}>
              {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
              {i === firstUnreadIdx && (
                <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
              )}
              <div className="sys-line"><span>{renderSysLine(m, localNameOf, openPeerDetail)}</span></div>
            </div>
          );
        }
        // 撤回消息（M4-1）：居中系统行"撤回了一条消息"，隐藏原气泡；本人文本可"重新编辑"回填输入框。
        if (m.recalledAt) {
          const canReEdit = mine && m.contentType === "text" && !!m.content;
          return (
            <div className="msg-item" data-seq={m.convSeq} key={msgKey(m)}>
              {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
              {i === firstUnreadIdx && (
                <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
              )}
              <div className="sys-line">
                <span>{mine ? "你撤回了一条消息" : `${isGroupChat ? senderLabel(m) : "对方"}撤回了一条消息`}</span>
                {canReEdit && (
                  <button className="reedit-btn" onClick={() => setInput(m.content)}>重新编辑</button>
                )}
              </div>
            </div>
          );
        }
        // 相册宫格（M4+）：同 group_id 聚簇——主行渲染整个宫格，从行跳过。多选态**同样聚簇**：整组作为一个
        // 勾选单位（不再拆成独立行），勾选左侧检查框即选中整组（见 toggleSelectedGroup / albumSelected）。
        if (isAlbumMember(m)) {
          if (!isAlbumLeader(messages, i)) return null;
          const members = albumMembers(messages, m.groupId!);
          const last = members[members.length - 1];
          // 相册尾条的 conv_seq（供「可见即读」：主行虽只带 data-seq=主行 seq，但看到宫格=看到整组，
          // 已读须能推进到末条，否则以相册结尾的会话未读永远卡在相册首条、清不掉。乐观态 seq=0 取到者忽略）。
          const albumEndSeq = members.reduce((mx, mm) => Math.max(mx, mm.convSeq || 0), 0);
          // 整组共用一条失败/拒收表达（同批发送、同一原因被拒）：取首个带 note 的成员。
          const notedMember = members.find((mm) => mm.note);
          const albumFailed = mine && members.some((mm) => mm.status === "failed");
          // 多选：整组作为一个勾选单位——可选成员=已入库(convSeq>0)未撤回；整组"已选"=全部可选成员都在选择集。
          const memberSeqs = members.filter((mm) => mm.convSeq > 0 && !mm.recalledAt).map((mm) => mm.convSeq);
          const albumSelectable = memberSeqs.length > 0;
          const albumSelected = albumSelectable && memberSeqs.every((s) => selected.has(s));
          const grid = (
            <div className="bubble-line">
              {albumFailed && <span className="fail-badge" title={notedMember?.note || "发送失败"}>!</span>}
              <AlbumGrid members={members}
                timeLabel={last?.timestamp ? formatTime(last.timestamp, timeFormat) : ""}
                progress={uploadProgress}
                gateFor={(mm) => !!mediaGate(mm)}
                expiredFor={(mm) => mediaGate(mm)?.phase === "expired"}
                onMediaError={onPassiveMediaError}
                onOpen={(mm) => { if (selectMode) return; mediaGate(mm) ? onGateTap(mm) : onMediaBubbleTap(mm, () => setViewer({ m: mm })); }}
                onMenu={(e, mm) => { e.preventDefault(); if (selectMode) return; setMenu({ x: e.clientX, y: e.clientY, m: mm }); }}
                selectMode={selectMode}
                isSelected={(mm) => selected.has(mm.convSeq)}
                onToggleTile={(mm) => toggleSelected(mm.convSeq)} />
            </div>
          );
          return (
            <div className={`msg-item${grouped ? " grouped" : ""}`} data-seq={m.convSeq} data-seq-end={albumEndSeq || undefined} key={msgKey(m)}>
              {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
              {i === firstUnreadIdx && (
                <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
              )}
              <div className={`row ${mine ? "me" : "them"}${selectMode ? " selecting" : ""}`}>
                {/* 左侧勾选框 = 整组全选/全不选 + 全选态指示（逐格勾选走宫格内 album-sel）。 */}
                {selectMode && albumSelectable && (
                  <span className={`sel-check${albumSelected ? " on" : ""}`}
                    onClick={(e) => { e.stopPropagation(); toggleAlbumGroup(memberSeqs); }}>{albumSelected ? "✓" : ""}</span>
                )}
                {grpThem ? (
                  <div className="them-wrap">
                    <div className="avatar-col">
                      {showAvatar && <Avatar cls="avatar bubble-avatar" url={senderAvatar(m)} label={senderLabel(m)} seed={m.from} onClick={() => openPeerDetail(m.from)} />}
                    </div>
                    <div className="them-stack">
                      {showSender && (
                      <span className="sender-row">
                        <span className="sender-name">{senderLabel(m)}</span>
                        {senderRole(m) === "owner" && <span className="role-badge owner">群主</span>}
                        {senderRole(m) === "admin" && <span className="role-badge">管理员</span>}
                      </span>
                    )}
                      {grid}
                    </div>
                  </div>
                ) : grid}
              </div>
              {/* 被拒收系统行（整组一条）：此前相册分支完全没有，图片被拒时既无文案也无恢复入口。 */}
              {albumFailed && notedMember?.note && (
                <div className="sys-note">
                  <span>{notedMember.note}</span>
                  {notedMember.noteCode === 200103 && peer && (
                    <button className="sys-note-action" onClick={() => void requestFriendFromNote(peer)}>发送好友申请</button>
                  )}
                </div>
              )}
            </div>
          );
        }
        // 媒体气泡：时间/已读压在图上（右下角），故不再渲染气泡下方的 .bmeta 行。
        const isMediaBubble = m.contentType === "image" || m.contentType === "video";
        // voice 内部 VoiceBubble 自带 meta（时长·HH:mm·✓/✓✓），外层 bmeta 再画一遍就会双时间叠印
        // （2026-08-27 修）。不并入 isMediaBubble（那会带来 .bubble.media 的 padding:0/overflow:hidden，
        // 语音气泡内部另有自己的 padding，会挤成一坨）——只让外层 bmeta 跳过 voice。
        const isVoiceBubble = m.contentType === "voice";
        const uploading = uploadProgress[m.clientMsgId ?? ""];
        // 暂停态唯一真相=分片任务（toggleUploadPause bump 进度对象触发重渲染）；小文件无任务恒 false。
        const uploadPaused = !!chunkedTaskFor(m.clientMsgId ?? "")?.paused;
        const durationText = m.contentType === "video" ? formatMediaDuration(m.duration) : "";
        // 下载门控（M4-7）：undefined=就绪；非空=未下载/下载中/失败/已失效 → 卡片显 ↓ 或进度，不加载原件。
        const gate = mediaGate(m);
        // 右键/长按选中态（方案A）：菜单作用的目标消息稳态高亮。身份走 msgKey（与 React key 同一唯一来源）
        // ——convSeq 优先，发送中 convSeq=0 回退 clientMsgId 区分，避免多条 sending 一起亮。
        const menuActive = !!menu && msgKey(menu.m) === msgKey(m);
        const bubbleBlock = (
          <>
            <div className="bubble-line">
              {mine && m.status === "failed" && (
                <span className="fail-badge" title={m.note || "发送失败"}>!</span>
              )}
              <div className={`bubble${isMediaBubble ? " media" : ""}${menuActive ? " ctx-active" : ""}`}
                onContextMenu={(e) => { if (selectMode) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, m }); }}>
                {/* 转发消息按普通消息显示（隐私保护）：不再渲染"转发自 X"。forwardFrom 仍随消息保留，供再次转发保留最初作者链路，但不外显（与 iOS 拉齐）。 */}
                {m.replyToConvSeq ? (
                  // 引用条：媒体内嵌小缩略图；群聊两行式——被引用者昵称（accent）+ 内容预览（M4-x，单聊不显示发送者）。
                  <div className="quote-bar" onClick={() => locateInChat(m.convId, m.replyToConvSeq!)}>
                    {(() => { const q = messages.find((x) => x.convSeq === m.replyToConvSeq);
                      // 图说消息（带 caption）：引用**只显文本**（快照即 caption），不挂媒体缩略图——简化、少出错。
                      if (q?.caption) return null;
                      // 原消息在本地 → 真帧/磨砂/图标由 QuoteThumb 定；不在本地 → 从快照文本推兜底图标（与 iOS 一致，别只剩文本）。
                      return q ? <QuoteThumb m={q} gated={!!mediaGate(q)} /> : <QuoteSnapshotIcon snapshot={m.replySnapshot} />; })()}
                    <span className="quote-lines">
                      {isGroupChat && m.replyToFrom && (
                        <span className="quote-who">{m.replyToFrom === uid ? "你" : localNameOf(m.replyToFrom, m.convId, m.replyToFrom)}</span>
                      )}
                      <span className="quote-text">{localizeSnippet(m.replySnapshot || "") || "原消息"}</span>
                    </span>
                  </div>
                ) : null}
                {isMediaBubble ? (
                  // 图片/视频：按 media_w/media_h 的原始比例定框（未知回退方块），
                  // 左上角时长或上传进度、右下角时间+已读态、视频居中播放角标——与 iOS 同版式。
                  // 点按走状态机（与 iOS 中心按钮一致）：失败 ↻ 重试 / 上传中 ⏸↔↑ / 其余打开查看器。
                  <span {...mediaBoxProps(m)}
                        onClick={() => (gate ? onGateTap(m) : onMediaBubbleTap(m, () => setViewer({ m })))}
                        title={gate ? downloadText(gate, formatFileSize(m.fileSize)) : undefined}>
                    {/* 门控（未下载）：不拉原图/原视频，只显 thumb 模糊占位（~200B data URI），没有就留灰底。 */}
                    {gate
                      ? (m.thumb
                          ? <img className="msg-image msg-image-blur" src={m.thumb} alt="未下载" />
                          : <span className="msg-image msg-image-empty" />)
                      : m.contentType === "video"
                        ? (m.posterUrl
                            ? <img className="msg-image" src={m.posterUrl} alt="视频" onLoad={onMediaLoad} onError={() => void onPassiveMediaError(m)} />
                            : <video className="msg-image" src={videoFrameSrc(mediaSrc(m))} preload="metadata" muted onLoadedData={onMediaLoad} onError={() => void onPassiveMediaError(m)} />)
                        : <img className="msg-image" src={mediaSrc(m)} alt="图片" onLoad={onMediaLoad} onError={() => void onPassiveMediaError(m)} />}
                    {gate
                      ? (gate.phase === "expired"
                          ? <span className="play-badge expired" title="已失效">⊘</span>
                          : downloadGlyph(gate) && <span className="play-badge">{downloadGlyph(gate)}</span>)
                      : uploading
                      ? (chunkedTaskFor(m.clientMsgId ?? "") && <span className="play-badge">{uploadPaused ? "↑" : "⏸"}</span>)
                      : (mine && m.status === "failed" && m.convSeq === 0 && pendingFilesRef.current.has(m.clientMsgId ?? ""))
                        ? <span className="play-badge">↻</span>
                        : m.contentType === "video" && <span className="play-badge">▶</span>}
                    {gate
                      ? <span className="media-badge media-badge-tl">
                          {/* 未下载=「大小 · 时长」（大小在前，与宫格/iOS 统一）；下载中/暂停/失败=只显状态，藏时长（省空间、防溢出）。 */}
                          {downloadText(gate, formatFileSize(m.fileSize), m.contentType as MediaKind)}{gate.phase === "notStarted" && durationText ? ` · ${durationText}` : ""}
                        </span>
                      : uploading
                      ? <span className="media-badge media-badge-tl">{uploadPaused ? "⏸ " : ""}{formatUploadProgress(uploading.sent, uploading.total)}</span>
                      : (durationText && <span className="media-badge media-badge-tl">{durationText}</span>)}
                    <span className="media-badge media-badge-br">
                      {mine
                        // 只有真正在传输才显「发送中…」；暂停时回落显示时间（与 iOS 一致）。
                        ? (m.status === "sending" ? (uploadPaused ? formatTime(m.timestamp, timeFormat) : "发送中…")
                          // 被拒收（有 note）时失败已由红❗+下方系统行表达，角标只显时间，不重复报错（与 iOS 一致）。
                          : m.status === "failed" ? (m.note ? formatTime(m.timestamp, timeFormat) : "未发送 ✗")
                          : <>{formatTime(m.timestamp, timeFormat)}<span className={readByPeer ? "ck read" : "ck"}>{readByPeer ? " ✓✓" : " ✓"}</span></>)
                        : formatTime(m.timestamp, timeFormat)}
                    </span>
                  </span>
                ) : m.contentType === "chat_record" ? (
                  // 合并转发卡片（镜像 iOS）：标题 + 前几条预览 + 脚注，点击进详情。
                  (() => { const r = parseChatRecord(m.content); return (
                    <div className="record-card" onClick={() => setRecordStack([r])}>
                      <div className="record-title">{r.t}</div>
                      <div className="record-preview">{r.items.slice(0, 4).map((it, i) => (
                        <div key={i} className="record-line">{it.n}: {recordItemPreview(it)}</div>
                      ))}</div>
                      <div className="record-foot">聊天记录</div>
                    </div>
                  ); })()
                ) : m.contentType === CONTACT_CONTENT_TYPE ? (
                  // 个人名片卡片（镜像 iOS IMContactCardCell）：头像 + 显示名 + ID + 脚注，点击进对方资料页。
                  // 落点用**已有的** openPeerDetail —— 与 iOS 落到 IMChatDetailViewController 是同一件事
                  //（QR 结果弹窗的「查看资料」走的也是它），不另造 modal。
                  (() => {
                    const card = parseContactCard(m.content);
                    // 脏名片（JSON 非法 / 缺 u）：退化成一行灰字、不可点——历史里不留点不动的死卡。
                    if (!card) return <div className="contact-card dirty">[个人名片]</div>;
                    // 主标题走**收方本地**显示名（备注优先），与会话/详情页同源，不会一处备注一处昵称。
                    const shown = localNameOf(card.userId, m.convId, card.nickname);
                    return (
                      <div className="contact-card" onClick={() => openPeerDetail(card.userId)}>
                        <div className="contact-card-head">
                          <Avatar url={card.avatarUrl} label={shown} seed={card.userId} cls="avatar" />
                          <div className="contact-card-body">
                            <div className="contact-card-name">{shown}</div>
                            {/* @句柄而非内部 ID（10 位随机数字）。老消息无 un → 该行不渲染。 */}
                            {card.username && <div className="contact-card-id">@{card.username}</div>}
                          </div>
                        </div>
                        <div className="contact-card-foot"><IdCard size={12} aria-hidden="true" />个人名片</div>
                      </div>
                    );
                  })()
                ) : m.contentType === "voice" ? (
                  // 语音气泡（P0，Web 只播不录，见 IMServer docs/VOICE_MESSAGE_DESIGN §10）：
                  // ▶ + 波形 + m:ss + 未播红点；单例 audio 同页面一次只播一条。
                  <VoiceBubble m={m} mine={mine} uid={uid} audioSrc={mediaSrc(m)}
                               readByPeer={readByPeer} timeFormat={timeFormat} />
                ) : m.contentType === "file" ? (
                  // 上传中（content 还没有 URL）不渲染成可点下载的 <a>，改显进度条 + 已传/总大小。
                  uploading || !m.content ? (
                    <span className={`msg-file${m.status === "failed" ? " failed" : ""}`}
                          onClick={m.status === "failed" ? () => retryUpload(m)
                                 : uploading ? () => toggleUploadPause(m) : undefined}>
                      <FileTypeIcon name={m.fileName || ""} size={30} />
                      <span className="msg-file-body">
                        <span className="msg-file-name">{m.fileName || "文件"}</span>
                        <span className="msg-file-size">
                          {m.status === "failed"
                            ? `${formatFileSize(m.fileSize)} · 上传失败，点击重试`
                            : uploading
                              ? `${formatUploadProgress(uploading.sent, uploading.total)}${
                                  chunkedTaskFor(m.clientMsgId ?? "") ? (uploadPaused ? " · 已暂停，点击继续" : " · 点击暂停") : ""}`
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
                    // 进度改由 FileGateIcon 的圆环表示（去底部线性条），图标槽位恒定 → 状态切换不撑高卡片。
                    <span className={`msg-file${gate.phase === "failed" || gate.phase === "expired" ? " failed" : ""}`}
                          onClick={() => onGateTap(m)}
                          title={gate.phase === "expired" ? "文件已失效" : "点击下载"}>
                      <FileGateIcon state={gate} />
                      <span className="msg-file-body">
                        <span className="msg-file-name">{m.fileName || fileNameFromContent(m.content)}</span>
                        <span className="msg-file-size">
                          {gate.phase === "notStarted"
                            ? (formatFileSize(m.fileSize) ? `${formatFileSize(m.fileSize)} · 点击下载` : "点击下载")
                            : downloadText(gate, formatFileSize(m.fileSize))}
                        </span>
                      </span>
                    </span>
                  ) : (
                    // 就绪：点击路由（可预览类型新标签预览 / 其余另存，对齐 iOS QuickLook）。已手动下过走应用内 blob。
                    <span className="msg-file clickable" onClick={() => openReadyFile(m)}
                          title={isPreviewableFile(m.fileName || fileNameFromContent(m.content)) ? "点击预览" : "点击下载"}>
                      <FileTypeIcon name={m.fileName || fileNameFromContent(m.content)} size={30} />
                      <span className="msg-file-body">
                        <span className="msg-file-name">{m.fileName || fileNameFromContent(m.content)}</span>
                        {formatFileSize(m.fileSize) && <span className="msg-file-size">{formatFileSize(m.fileSize)}</span>}
                      </span>
                    </span>
                  )
                ) : isUrlText(m.content) ? (
                  // 纯 URL 消息：可点击 URL 文本 + 下方 OG 富预览卡片（引用/普通消息一致）。
                  <LinkCard url={m.content} fetchPreview={fetchLinkPreview} onMediaLoad={onMediaLoad}
                            onOpenInvite={(u) => void handleScanRaw(u)} />
                ) : (
                  // 文本气泡：正文（含 URL 高亮 <a>）+ 若首个 URL 存在则挂 preview 卡（cardOnly=不再重复 URL 文本行）。
                  // 抓不到 og 时 LinkCard 内部返回 null 静默隐藏（负缓存），只留正文里的高亮 —— 与 iOS 一致。
                  <>
                    {renderMessageText(m)}
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
                {!isMediaBubble && !isVoiceBubble && (
                  <span className="bmeta">
                    {m.editedAt ? <span className="edited-tag">已编辑 </span> : null}
                    {mine ? (
                      m.status === "sending" ? "发送中…"
                        : m.status === "failed" ? (m.note ? null : <span className="failed">发送失败 ✗</span>)
                          : <>{formatTime(m.timestamp, timeFormat)}<span className={readByPeer ? "ck read" : "ck"}>{readByPeer ? " ✓✓" : " ✓"}</span></>
                    ) : (
                      formatTime(m.timestamp, timeFormat)
                    )}
                  </span>
                )}
              </div>
            </div>
            {m.convSeq > 0 && translations[m.convSeq] && (
              <div className="translation"><span>{translations[m.convSeq]}</span></div>
            )}
            {/* 语音转写面板（服务端识别）：空串=识别中。左侧引用线 + 文本 + 尾行隐私说明，与 iOS 同视觉语系。 */}
            {m.convSeq > 0 && transcripts?.[m.convSeq] !== undefined && (
              <div className={`voice-transcript${mine ? " mine" : ""}`}>
                <span className="voice-transcript-text">
                  {transcripts[m.convSeq] || "识别中…"}
                </span>
                {transcripts[m.convSeq] && (
                  <span className="voice-transcript-foot">📝 由服务器识别，结果可能不完全准确</span>
                )}
              </div>
            )}
          </>
        );
        return (
          <div className={`msg-item${grouped ? " grouped" : ""}`} data-seq={m.convSeq} key={msgKey(m)}>
            {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
            {i === firstUnreadIdx && (
              <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>
            )}
            <div className={`row ${mine ? "me" : "them"}${selectMode ? " selecting" : ""}`}
              onClick={!selectMode ? undefined
                : selectableInMultiSelect(m) ? () => toggleSelected(m.convSeq)
                // 发送中/失败的本地件：无勾选圈，点按直接提示原因（系统行/撤回墓碑静默）。
                : m.convSeq <= 0 && m.contentType !== "system" ? () => setToast("发送中/失败的消息不可选择")
                : undefined}>
              {selectMode && selectableInMultiSelect(m) && (
                <span className={`sel-check${selected.has(m.convSeq) ? " on" : ""}`}>{selected.has(m.convSeq) ? "✓" : ""}</span>
              )}
              {grpThem ? (
                // 群聊对方：左侧头像列（连续段末条显头像）+ 昵称（连续段首条）在气泡上方。
                <div className="them-wrap">
                  <div className="avatar-col">
                    {showAvatar && <Avatar cls="avatar bubble-avatar" url={senderAvatar(m)} label={senderLabel(m)} seed={m.from} onClick={() => openPeerDetail(m.from)} />}
                  </div>
                  <div className="them-stack">
                    {showSender && (
                      <span className="sender-row">
                        <span className="sender-name">{senderLabel(m)}</span>
                        {senderRole(m) === "owner" && <span className="role-badge owner">群主</span>}
                        {senderRole(m) === "admin" && <span className="role-badge">管理员</span>}
                      </span>
                    )}
                    {bubbleBlock}
                  </div>
                </div>
              ) : bubbleBlock}
            </div>
            {mine && m.status === "failed" && m.note && (
              <div className="sys-note">
                <span>{m.note}</span>
                {/* 恢复入口：仅非好友(200103) 给——被拉黑(200102) 刻意不给，服务端对两者回同样的
                    模糊文案以不泄露拉黑，给了入口反而会因申请被 200102 拒而暴露。 */}
                {m.noteCode === 200103 && peer && (
                  <button className="sys-note-action" onClick={() => void requestFriendFromNote(peer)}>发送好友申请</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** 系统消息一行：有分段就逐段渲染（名字换本地显示名、染色可点），没有就回退整句。
 *  历史系统消息（服务端当时没存分段）走回退分支：名字仍是当时的昵称、不可点。 */
function renderSysLine(
  m: ChatMessage,
  localNameOf: (uid: string, convId: string, fallback?: string) => string,
  openPeerDetail: (uid: string) => void,
): ReactNode {
  if (!m.sysSegments?.length) return m.content;
  return m.sysSegments.map((seg, i) =>
    seg.uid ? (
      <button key={i} type="button" className="sys-name" onClick={() => openPeerDetail(seg.uid!)}>
        {localNameOf(seg.uid, m.convId, seg.text)}
      </button>
    ) : (
      <Fragment key={i}>{seg.text}</Fragment>
    ),
  );
}
