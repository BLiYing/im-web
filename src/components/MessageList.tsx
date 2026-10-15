// MessageList：聊天消息流的逐行渲染（系统行/撤回墓碑/相册宫格/多选勾选；普通消息气泡见 MessageBubble，与置顶面板共用）。
//从 App.tsx 平移（阶段 1，行为保持型：JSX 逐字搬，CODING_STYLE §7）。
// - **稳定动作**从 ChatActionsContext 取（setMenu/setViewer/onGateTap/...，App 侧 useMemo 一次）；
// - **reactive 值与 App 内闭包**（messages/selectMode/mediaGate/senderLabel/renderMessageText/...）走 props；`.msgs` 滚动容器与 onScroll 仍留在 App（§7 缓拆），本组件只出行。
// 护栏：App.messageList.test.tsx（15 例）+ App.smoke.test.tsx。
import { Fragment, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useT, useLang, type Args, type Lang } from "../i18n";
import type { ChatMessage } from "../sdk/protocol";
import { buildGroupSysSegments } from "../sysEventRender";
import { pickNextVoiceRelay, voiceRelayMid } from "../voiceRelay";
import { albumMembers, albumTickState, isAlbumLeader, isAlbumMember, msgKey } from "../album";
import { formatTime, isSameDay, dayHeader, type TimeFormat } from "../time";
import { sysSegmentName } from "../sysSegments";
import { selectableInMultiSelect } from "../messageContent";
import { CALL_CONTENT_TYPE, renderCallRecord } from "../callRecord";
import { CallSysItem } from "./CallRecordBubble";
import { AlbumGrid } from "./AlbumGrid";
import { setVoiceRelayResolver, voicePlayedSet } from "./VoiceBubble";
import { MessageBubble, SenderColumn, type BubbleEnv } from "./MessageBubble";
import { useChatActions } from "../ChatActionsContext"; import { resendPolicyFor } from "../resendPolicy"; import { useExpiryProbe } from "../useExpiryProbe";

export interface MessageListProps extends BubbleEnv {
  messages: ChatMessage[];
  peer: string;
  isGroupChat: boolean;
  uid: string;
  selectMode: boolean;
  selected: Set<number>;
  menu: { m: ChatMessage } | null;
  readSeq: number;
  /** 大群（超级群）：已读语义整套关闭，气泡尾巴不画已读勾（SUPERGROUP_DESIGN §4）。 */
  isSuperGroup?: boolean;
  firstUnreadIdx: number;
  timeFormat: TimeFormat;
  translations: Record<number, string>;
  /** convSeq -> 语音转写文本；空串=识别中，undefined=未展开。 */
  transcripts?: Record<number, string>;
  uploadProgress: Record<string, { sent: number; total: number }>;
  dividerRef: RefObject<HTMLDivElement>;
  // App 内闭包（mediaGate/mediaSrc/senderLabel/renderMessageText/openPeerDetail/... 见 BubbleEnv，随 groupInfos/dlBlobs/搜索态等变化，不能进 context）
  requestFriendFromNote: (target: string) => void;
}

export function MessageList(p: MessageListProps) {
  const tr = useT();
  const lang = useLang(); // P3：多人名拼接/常用地拼接按语言选分隔符
  const {
    messages, peer, isGroupChat, isSuperGroup, uid, selectMode, selected, menu, readSeq, firstUnreadIdx,
    timeFormat, uploadProgress, dividerRef, mediaGate, mediaSrc, senderLabel, localNameOf, openPeerDetail, requestFriendFromNote,
  } = p;
  const {
    setMenu, setViewer, setInput, setToast, onGateTap, onMediaBubbleTap, onPassiveMediaError, resendMessage, toggleSelected,
  } = useChatActions();
  useExpiryProbe(messages, mediaGate); // 进会话就探门控媒体是否已被服务端清理（与群资料媒体页签同一套失效登记）
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
                <div className="unread-divider" ref={dividerRef}><span>{tr("chat.unread_divider")}</span></div>
              )}
              <div className="sys-line"><span>{renderSysLine(m, uid, localNameOf, openPeerDetail, tr, lang)}</span></div>
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
                <div className="unread-divider" ref={dividerRef}><span>{tr("chat.unread_divider")}</span></div>
              )}
              <div className="sys-line">
                <span>{mine ? tr("conv.list.recalled_self") : isGroupChat ? tr("conv.list.recalled_member", { name: senderLabel(m) }) : tr("conv.list.recalled_peer")}</span>
                {canReEdit && (
                  <button className="reedit-btn" onClick={() => setInput(m.content)}>{tr("chat.message.reedit")}</button>
                )}
              </div>
            </div>
          );
        }
        // 通话记录（content_type=call）：单聊 = 普通气泡里的图标+文字（下方走通用气泡分支），点整个气泡按原类型回拨；
        // 群聊 = 居中系统条（不可点）；解析失败 = 灰色一行兜底，绝不显示 JSON。
        const callView = m.contentType === CALL_CONTENT_TYPE
          ? renderCallRecord(m.content, { viewerIsSender: mine, isGroup: isGroupChat,
              senderName: mine ? undefined : localNameOf(m.from, m.convId, m.fromNickname) }, tr)
          : null;
        if (m.contentType === CALL_CONTENT_TYPE && (!callView || !callView.tappable)) {
          return <CallSysItem key={msgKey(m)} seq={m.convSeq} text={callView?.text ?? tr("call.record.unsupported")}
                              dateLabel={showDate ? dayHeader(m.timestamp) : ""} unread={i === firstUnreadIdx} dividerRef={dividerRef} />;
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
          // 整组共用一个红❗ → 只要还有一格能重发就可点，点一次重发组里所有失败成员。
          const albumResendable = members.some((mm) => resendPolicyFor(mm, mine) !== "none");
          // 多选：整组作为一个勾选单位——可选成员=已入库(convSeq>0)未撤回；整组"已选"=全部可选成员都在选择集。
          const memberSeqs = members.filter((mm) => mm.convSeq > 0 && !mm.recalledAt).map((mm) => mm.convSeq);
          const albumSelectable = memberSeqs.length > 0;
          const albumSelected = albumSelectable && memberSeqs.every((s) => selected.has(s));
          const grid = (
            <div className="bubble-line">
              {albumFailed && (
                <button type="button" className="fail-badge" disabled={!albumResendable}
                        title={notedMember?.note || (albumResendable ? tr("chat.message.send_failed_resend") : tr("common.send_failed"))}
                        onClick={() => resendMessage(m, messages)}>!</button>
              )}
              <AlbumGrid members={members}
                timeLabel={last?.timestamp ? formatTime(last.timestamp, timeFormat) : ""} tick={albumTickState(members, mine, readSeq, isSuperGroup)}
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
                <div className="unread-divider" ref={dividerRef}><span>{tr("chat.unread_divider")}</span></div>
              )}
              <div className={`row ${mine ? "me" : "them"}${selectMode ? " selecting" : ""}`}>
                {/* 左侧勾选框 = 整组全选/全不选 + 全选态指示（逐格勾选走宫格内 album-sel）。 */}
                {selectMode && albumSelectable && (
                  <span className={`sel-check${albumSelected ? " on" : ""}`}
                    onClick={(e) => { e.stopPropagation(); toggleAlbumGroup(memberSeqs); }}>{albumSelected ? "✓" : ""}</span>
                )}
                {grpThem ? (
                  <SenderColumn m={m} showAvatar={showAvatar} showSender={showSender} env={p}>{grid}</SenderColumn>
                ) : grid}
              </div>
              {/* 被拒收系统行（整组一条）：此前相册分支完全没有，图片被拒时既无文案也无恢复入口。 */}
              {albumFailed && notedMember?.note && (
                <div className="sys-note">
                  <span>{notedMember.note}</span>
                  {notedMember.noteCode === 200103 && peer && (
                    <button className="sys-note-action" onClick={() => requestFriendFromNote(peer)}>{tr("chat.system.send_friend_request")}</button>
                  )}
                </div>
              )}
            </div>
          );
        }
        // 右键/长按选中态（方案A）：菜单作用的目标消息稳态高亮。身份走 msgKey（与 React key 同一唯一来源）
        // ——convSeq 优先，发送中 convSeq=0 回退 clientMsgId 区分，避免多条 sending 一起亮。
        const menuActive = !!menu && msgKey(menu.m) === msgKey(m);
        // 气泡本体（含翻译/转写）：见 MessageBubble（与置顶面板同源渲染）。
        const bubbleBlock = <MessageBubble {...p} m={m} menuActive={menuActive} />;
        return (
          <div className={`msg-item${grouped ? " grouped" : ""}`} data-seq={m.convSeq} key={msgKey(m)}>
            {showDate && <div className="date-pill"><span>{dayHeader(m.timestamp)}</span></div>}
            {i === firstUnreadIdx && (
              <div className="unread-divider" ref={dividerRef}><span>{tr("chat.unread_divider")}</span></div>
            )}
            <div className={`row ${mine ? "me" : "them"}${selectMode ? " selecting" : ""}`}
              onClick={!selectMode ? undefined
                : selectableInMultiSelect(m) ? () => toggleSelected(m.convSeq)
                // 发送中/失败的本地件：无勾选圈，点按直接提示原因（系统行/撤回墓碑静默）。
                : m.convSeq <= 0 && m.contentType !== "system" ? () => setToast(tr("chat.select.unsent_blocked"))
                : undefined}>
              {selectMode && selectableInMultiSelect(m) && (
                <span className={`sel-check${selected.has(m.convSeq) ? " on" : ""}`}>{selected.has(m.convSeq) ? "✓" : ""}</span>
              )}
              {grpThem ? (
                // 群聊对方：左侧头像列（连续段末条显头像）+ 昵称（连续段首条）在气泡上方。
                <SenderColumn m={m} showAvatar={showAvatar} showSender={showSender} env={p}>{bubbleBlock}</SenderColumn>
              ) : bubbleBlock}
            </div>
            {mine && m.status === "failed" && m.note && (
              <div className="sys-note">
                <span>{m.note}</span>
                {/* 恢复入口：仅非好友(200103) 给——被拉黑(200102) 刻意不给——它的文案是不带「请先发送好友申请」的模糊拒收，
                    给了入口反而会因申请被 200102 拒而暴露。 */}
                {m.noteCode === 200103 && peer && (
                  <button className="sys-note-action" onClick={() => void requestFriendFromNote(peer)}>{tr("chat.system.send_friend_request")}</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
/** 系统消息一行：有分段就逐段渲染（名字换本地显示名、染色可点），没有就回退整句。P3 起 sysEvent
 *  认识时先用 buildGroupSysSegments 按 App 语言重建分段（喂给同一套渲染），不认识/为空回退 m.sysSegments。 */
function renderSysLine(
  m: ChatMessage, uid: string,
  localNameOf: (uid: string, convId: string, fallback?: string) => string,
  openPeerDetail: (uid: string) => void, t: (key: string, args?: Args) => string, lang: Lang,
): ReactNode {
  const segs = buildGroupSysSegments(m, t, lang) ?? m.sysSegments;
  if (!segs?.length) return m.content;
  return segs.map((seg, i) =>
    seg.uid ? (
      <button key={i} type="button" className="sys-name" onClick={() => openPeerDetail(seg.uid!)}>
        {sysSegmentName(seg.uid, uid, (id) => localNameOf(id, m.convId, seg.text))}
      </button>
    ) : (
      <Fragment key={i}>{seg.text}</Fragment>
    ),
  );
}
