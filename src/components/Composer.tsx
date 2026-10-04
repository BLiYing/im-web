// Composer：聊天列底部区——跳底钮 / 拉黑提示 / 编辑态条 / 引用回复条 / 多选工具栏 / 粘贴预览条 / 附件弹层 / @提及面板 / 输入框+发送。
// 阶段 3 从 App.tsx 整块平移（JSX 逐字一致，行为保持型，CODING_STYLE §7）。发送/粘贴/@解析等**逻辑仍在 App**
// （与 msgsByConv/pendingFiles/mention 状态互咬，§7「胶水别硬抽」），本组件只出 JSX：
// - 稳定动作与 ref（send/pickFile/onInputChange/composerRef…皆 useCallback/useRef，定义均在 login 早退前）走 ChatActionsContext；
// - reactive 值（input/replyTo/editingMsg/selectMode/pastedImages/mentionRows…）走 props。
// 护栏：Composer.test.tsx + App.smoke.test.tsx（发消息主链路）。
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Bookmark, Flag, Forward, Mic, Trash2, type LucideIcon, IdCard } from "lucide-react";
import type { ChatMessage } from "../sdk/protocol";
import type { AttachmentPickMode } from "../attachments";
import { VoiceRecorder, VOICE_COUNTDOWN_START_MS, VOICE_MAX_MS } from "../voiceRecorder";
import { platform } from "../platform";
import { t, useT } from "../i18n";
import { pauseVoicePlayback } from "./VoiceBubble";
import type { DownloadState } from "../download";
import { replyPreviewOf } from "../messageContent";
import { FileTypeIcon } from "../FileTypeIcon";
import { Avatar } from "./Avatar";
import { QuoteThumb } from "./QuoteThumb";
import { useChatActions } from "../ChatActionsContext";
import { useFileDrop } from "../useFileDrop";
import { unreadBadgeText } from "../unreadBadge";

export type MentionRow = { label: string; userId: string | null; role?: string; avatarUrl?: string; note?: string };
export type AttachItem = { id: string; label: string; accept: string; icon: LucideIcon };

export interface ComposerProps {
  convId: string;
  peer: string;
  uid: string;
  isGroupChat: boolean;
  peerLabel: string;
  peerBlocked: boolean;
  input: string;
  sendKey: "enter" | "cmd";
  composerMuteReason: string | null;
  showJump: boolean;
  jumpCount: number;
  /** ↓N 撞到服务端未读上限（真实值 ≥ jumpCount）→ 角标补 "+"。 */
  jumpCapped?: boolean;
  editingMsg: ChatMessage | null;
  replyTo: ChatMessage | null;
  selectMode: boolean;
  selected: Set<number>;
  /** 多选批量举报可否点击：所选**全是同一个对方**发的才回该发送者 uid，否则 null（按钮置灰）。 */
  reportableSender: string | null;
  /** 置灰原因二选一：所选里含我自己发的（true）还是跨了多个发送者（false）。只用于灰态提示文案。 */
  reportHasMine: boolean;
  /** 多选删除是否给「为所有人删除」这一档：所选全部是我发的，或我是群主/管理员（见 selectDelete.ts）。 */
  canDeleteEveryone?: boolean;
  pastedImages: { file: File; url: string; kind: "image" | "video" | "file" }[];
  attachPanel: boolean;
  attachItems: AttachItem[];
  mentionQuery: string | null;
  mentionFilter: string;
  mentionRows: MentionRow[];
  mentionActive: number;
  // App 内闭包 / 晚定义
  mediaGate: (m: ChatMessage) => DownloadState | undefined;
  senderLabel: (m: ChatMessage) => string;
  onMentionNavKey: (e: KeyboardEvent<HTMLTextAreaElement> | KeyboardEvent<HTMLInputElement>) => boolean;
}

export function Composer(p: ComposerProps) {
  const tr = useT(); // JSX 用 tr（订阅语言）；回调里用模块级 t（调用时刻读语言）
  const {
    convId, peer, uid, isGroupChat, peerLabel, peerBlocked, input, sendKey, composerMuteReason, showJump, jumpCount, jumpCapped,
    editingMsg, replyTo, selectMode, selected, reportableSender, reportHasMine, canDeleteEveryone, pastedImages, attachPanel, attachItems,
    mentionQuery, mentionFilter, mentionRows, mentionActive, mediaGate, senderLabel, onMentionNavKey,
  } = p;
  const {
    setInput, locateInChat, jumpToBottom, unblock, setEditingMsg, setReplyTo, exitSelectMode, forwardSelected, favoriteSelected, reportSelected, deleteSelected, deleteSelectedForEveryone,
    removePastedImage, cancelAttachClose, scheduleAttachClose, setAttachPanel, pickFile, openFavoritesPick, openContactPicker, onFilePicked,
    setMentionFilter, pickMention, setMentionActive, onInputChange, onComposerPaste, addPastedFiles, send,
    sendVoice, setToast,
    attachAnchorRef, fileInputRef, mentionPanelRef, mentionActiveRef, composerRef,
  } = useChatActions();
  const [delConfirm, setDelConfirm] = useState(false); // 多选删除二次确认气泡（「仅为我删除」/「为所有人删除」）
  // 输入栏此刻能不能用（有会话、没被禁言）。输入框 / 发送钮 / 麦克风 / 拖文件**共用这一处**——
  // 各写各的话，将来加第三个禁用条件时漏改一处，就会出现「输入框灰着、文件却拖得进去」。
  const composerUsable = !!convId && composerMuteReason === null;
  // 从系统拖文件进聊天列 → 与粘贴同一条路进预览条（见 useFileDrop 顶部）。
  // 多选态下输入栏整个换成了工具栏，也不收。
  useFileDrop({
    enabled: composerUsable && !selectMode,
    onFiles: (files) => { addPastedFiles(files, "drop"); composerRef.current?.focus(); },
  });
  // Web P1 语音：AAC 兼容探测 → 麦克风入口置灰/激活；点击开录 → 输入栏 morph 成录制条。
  // ChatActions.sendVoice 上传+发送；Space/Esc/Enter 快捷键在录制条 focus 时接管。
  const voiceProbe = useMemo(() => platform().voiceRecording(), []);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const [recordAmps, setRecordAmps] = useState<number[]>([]);
  const [voicePaused, setVoicePaused] = useState(false);
  // 这次录音属于**哪个会话**。录音条与快捷键都按它收口，发送也发到它——
  // 不记这一位的话，在 A 会话录到一半切到 B，录音条跟着 B 显示，一按发送这段话就发给了 B（用户实测）。
  const [recordConv, setRecordConv] = useState("");
  const recordConvRef = useRef("");
  const [previewing, setPreviewing] = useState(false);   // 暂停态「预听」是否在响
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const recordingHere = recording && recordConv === convId;

  /** 停预听并回收 objectURL（暂停键/发送/取消/切会话/卸载都要走它）。 */
  const stopPreview = useCallback(() => {
    const a = previewRef.current;
    previewRef.current = null;
    if (a) {
      a.pause();
      a.onended = null; a.onerror = null;
      if (a.src.startsWith("blob:")) URL.revokeObjectURL(a.src);
    }
    setPreviewing(false);
  }, []);

  const startVoiceRecord = useCallback(async () => {
    if (recording || !voiceProbe.supported) return;
    // 别的会话还留着一段暂停的录音 → 只有一个 recorder，先丢掉它（recording 为真时按钮不会出现在
    // 本会话，但从别的会话点麦克风会走到这里）。
    recorderRef.current?.cancel();
    stopPreview();
    setRecording(true); setRecordElapsed(0); setRecordAmps([]); setVoicePaused(false);
    setRecordConv(convId); recordConvRef.current = convId;
    const r = new VoiceRecorder();
    recorderRef.current = r;
    try {
      await r.start({
        onTick: (amp, elapsed) => {
          setRecordElapsed(elapsed);
          setRecordAmps((prev) => (prev.length >= 40 ? [...prev.slice(1), amp] : [...prev, amp]));
        },
        onDone: (res) => {
          setRecording(false);
          recorderRef.current = null;
          const name = `voice-${Date.now()}${res.fileExtension}`;
          // **发到录音所属的那个会话**，不是"当前打开的会话"。
          void sendVoice(res.blob, name, res.waveformBase64, res.durationMs, recordConvRef.current);
        },
        onCancel: (reason) => {
          setRecording(false);
          recorderRef.current = null;
          if (reason === "tooShort") setToast(t("chat.voice.too_short"));
          else if (reason === "error") setToast(t("chat.voice.record_failed"));
        },
        onMaxReached: () => {
          // §12 硬闸：桌面天然锁定 → 自动送出；toast 告知用户"到点已自动发送"（分钟数由常量派生）。
          setToast(t("chat.voice.max_reached", { minutes: VOICE_MAX_MS / 60000 }));
        },
      });
    } catch (e) {
      setRecording(false);
      recorderRef.current = null;
      setToast((e as Error).message || t("chat.voice.cannot_start"));
    }
  }, [recording, voiceProbe.supported, convId, sendVoice, setToast, stopPreview]);

  const stopVoiceSend = useCallback(() => { stopPreview(); recorderRef.current?.stopAndSend(); }, [stopPreview]);
  const cancelVoice = useCallback(() => { stopPreview(); recorderRef.current?.cancel(); }, [stopPreview]);
  const togglePauseVoice = useCallback(() => {
    const r = recorderRef.current; if (!r) return;
    if (r.isPaused()) { stopPreview(); r.resume(); setVoicePaused(false); }
    else { r.pause(); setVoicePaused(true); }
  }, [stopPreview]);

  /** 暂停态预听已录的部分（iOS 锁定条的迷你播放器同款，见 IMChatViewController+Voice §14）。 */
  const togglePreview = useCallback(() => {
    if (previewing) { stopPreview(); return; }
    const blob = recorderRef.current?.previewBlob();
    if (!blob) { setToast(t("chat.voice.nothing_recorded")); return; }
    pauseVoicePlayback(); // 全站同一时刻只响一路：预听要盖过正在放的语音气泡
    const a = new Audio(URL.createObjectURL(blob));
    previewRef.current = a;
    a.onended = () => stopPreview();
    a.onerror = () => { stopPreview(); setToast(t("chat.voice.preview_failed")); };
    setPreviewing(true);
    void a.play().catch(() => { stopPreview(); setToast(t("chat.voice.preview_failed")); });
  }, [previewing, stopPreview, setToast]);

  // 切走会话 = 这段录音不再属于眼前这一页：**暂停并留着**，回到原会话还能续录/预听/发送。
  // 不直接丢弃——一段几分钟的话不该因为点错一下会话就没了；也不能继续跑，否则录音条挂在
  // 别人的会话上，一按发送就发错人（用户实测）。
  useEffect(() => {
    if (!recording || !recordConv || recordConv === convId) return;
    stopPreview();
    const r = recorderRef.current;
    if (r && !r.isPaused()) { r.pause(); setVoicePaused(true); }
    setToast(t("chat.voice.paused_toast"));
  }, [convId, recording, recordConv, stopPreview, setToast]);

  // 卸载兜底：预听的 audio 与 objectURL 不能随组件一起被丢下（声音会继续响）。
  useEffect(() => () => stopPreview(), [stopPreview]);

  // Space 暂停/继续、Esc 取消、Enter 发送（录制中生效，防冲突聊天列表滚动）。
  useEffect(() => {
    if (!recordingHere) return; // 只在录音所属的那个会话里接管键盘（否则在别的会话按 Enter 会把这段发错人）
    const onKey: (e: Event) => void = (e) => {
      const k = e as unknown as { key: string; code?: string; preventDefault(): void };
      if (k.key === "Escape") { k.preventDefault(); cancelVoice(); }
      else if (k.key === "Enter") { k.preventDefault(); stopVoiceSend(); }
      else if (k.key === " " || k.code === "Space") { k.preventDefault(); togglePauseVoice(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recordingHere, cancelVoice, stopVoiceSend, togglePauseVoice]);

  return (
    <>
      {showJump && convId && (
        <button className="jump-btn" onClick={jumpToBottom} title={tr("chat.jump_to_latest")}>
          ↓{jumpCount > 0 && <span className="jump-badge">{unreadBadgeText(jumpCount, jumpCapped)}</span>}
        </button>
      )}
      {peerBlocked && peer && (
        // 微信式单向：拉黑者仍可发、对方能收到；这里只给一条非阻断提示 + 解除入口，不禁用输入。
        <div className="block-hint">{tr("chat.block.hint")}<button className="link-inline" onClick={() => void unblock(peer)}>{tr("common.unblock")}</button></div>
      )}
      {editingMsg && (
        // 编辑态条（M4-5）：输入框上方显示"编辑消息" + 取消（恢复普通发送）。
        // 点预览区 → 定位到正在编辑的原消息（与引用条一致）；✕ 独立在点击区外。
        <div className="reply-compose">
          <div className="reply-compose-hit" onClick={() => locateInChat(editingMsg.convId, editingMsg.convSeq)} title={tr("chat.jump_to_original")}>
            <div className="reply-compose-text">
              <span className="reply-who">{tr("chat.edit.title")}</span>
              <span className="reply-snippet">{(editingMsg.content || "").slice(0, 80)}</span>
            </div>
          </div>
          <button className="reply-cancel" onClick={() => { setEditingMsg(null); setInput(""); }} title={tr("chat.edit.cancel")}>✕</button>
        </div>
      )}
      {replyTo && (
        // 引用回复条（M4-2）：输入框上方显示被引用消息预览 + 取消；图片/视频显示小缩略图。
        // 点预览区（缩略图+文字，不含 ✕）→ 定位到被引用的原消息（与 iOS 一致）；✕ 独立在点击区外。
        <div className="reply-compose">
          <div className="reply-compose-hit" onClick={() => locateInChat(replyTo.convId, replyTo.convSeq)} title={tr("chat.jump_to_original")}>
            {/* 图说消息（带 caption）：引用预览只显文本，不挂缩略图（与气泡内引用条一致，简化少出错）。 */}
            {!replyTo.caption && <QuoteThumb m={replyTo} gated={!!mediaGate(replyTo)} />}
            <div className="reply-compose-text">
              <span className="reply-who">{tr("chat.reply.who", { name: replyTo.from === uid ? tr("chat.reply.self") : (isGroupChat ? senderLabel(replyTo) : peerLabel) })}</span>
              <span className="reply-snippet">{replyPreviewOf(replyTo, tr)}</span>
            </div>
          </div>
          <button className="reply-cancel" onClick={() => setReplyTo(null)} title={tr("chat.reply.cancel")}>✕</button>
        </div>
      )}
      {selectMode ? (
        // 多选态工具栏（M4-3）：批量 转发/举报/收藏/删除——独立圆形 Liquid Glass 按钮、无工具栏背景（与 iOS 拉齐）。
        <footer className="select-bar">
          <button className="link-inline" onClick={() => { setDelConfirm(false); exitSelectMode(); }}>{tr("common.cancel")}</button>
          <span className="select-count">{tr("chat.select.selected", { count: selected.size })}</span>
          <button className="sel-action" title={tr("common.forward")} aria-label={tr("common.forward")} disabled={selected.size === 0} onClick={forwardSelected}><Forward size={22} aria-hidden="true" /></button>
          {/* 举报（2026-09-06）：仅当所选**全是同一个对方**发的才可点，否则**置灰不隐藏**——
              隐藏会让栏内按钮数随勾选变化，每勾一下按钮就左右跳一次。灰态的原因用 title 说明
              （鼠标悬停即见；disabled 按钮不触发 onClick，没法靠点击提示）。 */}
          <button className="sel-action" title={reportableSender || selected.size === 0 ? tr("common.report")
                    : reportHasMine ? tr("chat.select.report_own") : tr("chat.select.report_multi")}
                  aria-label={tr("common.report")} disabled={!reportableSender} onClick={reportSelected}><Flag size={22} aria-hidden="true" /></button>
          <button className="sel-action" title={tr("common.favorite")} aria-label={tr("common.favorite")} disabled={selected.size === 0} onClick={favoriteSelected}><Bookmark size={22} aria-hidden="true" /></button>
          {/* 删除：点按不直接删，先在按钮**上方**弹确认气泡，点里面的档位才删。两档与单条删除的子菜单同口径：
              「仅为我删除」恒有；所选全部有权（我发的 / 我是群主·管理员）时多一档「为所有人删除」，
              破坏性重的放最后（destructive-last）。iOS / Android 多选删除同口径（2026-09-30 拉齐）。 */}
          <span className="sel-del-wrap">
            <button className="sel-action danger" title={tr("common.delete")} aria-label={tr("common.delete")} disabled={selected.size === 0} onClick={() => setDelConfirm(true)}><Trash2 size={22} aria-hidden="true" /></button>
            {delConfirm && selected.size > 0 && (
              <>
                <span className="sel-del-backdrop" onClick={() => setDelConfirm(false)} />
                <span className="sel-del-pop" role="menu">
                  <button className="sel-del-only" role="menuitem" onClick={() => { setDelConfirm(false); deleteSelected(); }}>{tr("chat.select.delete_for_me")}</button>
                  {canDeleteEveryone && (
                    <button className="sel-del-only" role="menuitem" onClick={() => { setDelConfirm(false); deleteSelectedForEveryone(); }}>{tr("delete_sheet.everyone")}</button>
                  )}
                </span>
              </>
            )}
          </span>
        </footer>
      ) : (
        <>
          {pastedImages.length > 0 && (
            // 粘贴预览条（Web #2）：图片显缩略图、文件显类型图标+文件名；逐个 ✕ 移除，点发送统一发出。
            <div className="paste-preview">
              {pastedImages.map((pi, i) => (
                pi.kind === "image" ? (
                  <div key={pi.url} className="paste-thumb">
                    <img src={pi.url} alt={tr("chat.paste.pending_image_alt")} />
                    <button className="paste-remove" title={tr("common.remove")} onClick={() => removePastedImage(i)}>✕</button>
                  </div>
                ) : pi.kind === "video" ? (
                  // 视频：用 <video> 显首帧（muted+metadata），角标示意可播放；发送仍与图片同批走 sendMediaBatch。
                  <div key={pi.url} className="paste-thumb paste-video">
                    <video src={pi.url} muted preload="metadata" playsInline />
                    <span className="paste-video-badge" aria-hidden>▶</span>
                    <button className="paste-remove" title={tr("common.remove")} onClick={() => removePastedImage(i)}>✕</button>
                  </div>
                ) : (
                  <div key={pi.url} className="paste-thumb paste-file">
                    <FileTypeIcon name={pi.file.name} size={26} />
                    <span className="paste-file-name" title={pi.file.name}>{pi.file.name}</span>
                    <button className="paste-remove" title={tr("common.remove")} onClick={() => removePastedImage(i)}>✕</button>
                  </div>
                )
              ))}
            </div>
          )}
          <footer>
            <div className="attach-anchor" ref={attachAnchorRef}
              onMouseEnter={() => { cancelAttachClose(); if (convId) setAttachPanel(true); }}
              onMouseLeave={scheduleAttachClose}>
              <button className="attach-btn" disabled={!convId} title={tr("chat.attach.title")}
                aria-expanded={attachPanel && !!convId}
                onClick={() => setAttachPanel(true)}>＋</button>
              {attachPanel && convId && (
                // 毛玻璃气泡菜单：悬停或点击加号均打开，功能仍由数据数组驱动。
                <div className="attach-popover" role="menu"
                  onMouseEnter={cancelAttachClose} onMouseLeave={scheduleAttachClose}>
                  {attachItems.map((it) => (
                    <button key={it.id} className="attach-item" role="menuitem" onClick={() => pickFile(it.id as AttachmentPickMode, it.accept)}>
                      <it.icon size={24} aria-hidden="true" />
                      <span>{it.label}</span>
                    </button>
                  ))}
                  {/* 从收藏发送（对齐 iOS Pick）：打开收藏弹窗 pick 模式，选中项发进当前会话。 */}
                  <button className="attach-item" role="menuitem" onClick={openFavoritesPick}>
                    <Bookmark size={24} aria-hidden="true" />
                    <span>{tr("common.favorite")}</span>
                  </button>
                  {/* 个人名片（CONTACT_CARD_DESIGN §8.1 入口 ①）：选好友 → 二次确认 → 发进当前会话。 */}
                  <button className="attach-item" role="menuitem" onClick={openContactPicker}>
                    <IdCard size={24} aria-hidden="true" />
                    <span>{tr("chat.attach.contact_card")}</span>
                  </button>
                </div>
              )}
            </div>
            {/* 隐藏的文件选择器：三仓共用一个 input，`accept` 与 `multiple` **由 useMediaSend#pickFile
                按入口逐次赋值**（「图片或视频」= 多选，相册宫格靠它凑 ≥2 件；「文件」= 单选），
                所以这里刻意**不写死 multiple**——写死就没法按入口区分了，且会与 pickFile 争着写同一个属性。
                （React 不管它没在 JSX 里出现的属性，命令式赋的值能扛过重渲染，见 useMediaSend.test.ts。） */}
            <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFilePicked} />
            {/* @提及面板（M4-8，仅群聊）：贴输入框上方的内联下拉，边打字边过滤。
                支持 ↑/↓ 移动、Enter/Tab 选中、Esc 关闭（见 composer 的 onKeyDown）。
                「@所有人」仅群主/管理员可见——普通成员整行不渲染（服务端另有角色校验）。 */}
            {mentionQuery !== null && (
              <div className="mention-panel" role="listbox" aria-label={tr("chat.mention.title")} ref={mentionPanelRef}>
                {/* 顶部搜索框＝独立搜索：从空开始、不被消息框 @后文字回填；在此打字则以它为准过滤（否则列表跟随 @后字符）。 */}
                <input className="mention-search" value={mentionFilter} placeholder={tr("group.member.search")} aria-label={tr("group.member.search")}
                  onChange={(e) => setMentionFilter(e.target.value)}
                  onKeyDown={(e) => { onMentionNavKey(e); }} />
                {mentionRows.length > 0 ? mentionRows.map((r, i) => (
                  <button
                    key={r.userId ?? "@all"}
                    role="option"
                    aria-selected={i === mentionActive}
                    ref={i === mentionActive ? mentionActiveRef : undefined}
                    className={`mention-row${i === mentionActive ? " active" : ""}`}
                    // 用 mousedown 而非 click：click 之前 textarea 已 blur，光标位置会先丢。
                    onMouseDown={(e) => { e.preventDefault(); pickMention(r.label, r.userId); }}
                    onMouseEnter={() => setMentionActive(i)}
                  >
                    {r.userId
                      ? <Avatar label={r.label} seed={r.userId} url={r.avatarUrl} cls="avatar mention-avatar" />
                      : <span className="mention-all-ic">@</span>}
                    {/* 名字与备注同处一个 flex:1 的容器里，备注**紧挨**名字右侧；
                        角色徽标留在容器外，仍靠右。（备注单独一个 span 会被 .mention-name 的
                        flex:1 顶到行尾，离名字十万八千里。）
                        主名恒为**群内公开名**——选中后插进消息的就是它，不能拿备注当主名。 */}
                    <span className="mention-label">
                      <span className="mention-name">{r.label}</span>
                      {r.note && <span className="mention-note">{r.note}</span>}
                    </span>
                    {r.role === "owner" && <span className="role-badge owner">{tr("group.role.owner")}</span>}
                    {r.role === "admin" && <span className="role-badge">{tr("group.role.admin")}</span>}
                  </button>
                )) : <div className="mention-empty">{tr("chat.mention.empty")}</div>}
              </div>
            )}
            <textarea ref={composerRef} value={input} rows={1} disabled={!composerUsable}
              placeholder={composerMuteReason || (convId ? (sendKey === "cmd" ? tr("chat.input.placeholder_cmd") : tr("chat.input.placeholder_enter")) : tr("chat.input.placeholder_no_conv"))}
              onChange={(e) => onInputChange(e.target.value)}
              onPaste={onComposerPaste}
              onKeyDown={(e) => {
                // @面板打开时优先接管导航键：↑/↓ 移动、Enter/Tab 选中、Esc 关闭（与面板搜索框共用一套）。
                if (onMentionNavKey(e)) return;
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return; // 中文输入法组词中不触发
                // enter 模式：Enter 发送、Shift+Enter 换行；cmd 模式：Cmd/Ctrl+Enter 发送、Enter 换行。
                const shouldSend = sendKey === "cmd" ? (e.metaKey || e.ctrlKey) : !e.shiftKey;
                if (shouldSend) { e.preventDefault(); send(); }
              }} />
            {input.trim().length === 0 && pastedImages.length === 0 ? (
              // 空框：显麦克风（P1）。platform().voiceRecording() 探测为 false 的宿主 → 置灰 + tooltip。
              // （2026-09-07 实测：Chrome 已支持点名 AAC 的 audio/mp4，第一级探测即命中；置灰分支留给探测失败的浏览器。）
              <button className="mic-btn"
                      disabled={!composerUsable || !voiceProbe.supported}
                      title={voiceProbe.supported ? tr("chat.voice.start") : tr("chat.voice.unsupported")}
                      onClick={startVoiceRecord}>
                <Mic size={18} aria-hidden="true" />
              </button>
            ) : (
              <button onClick={send} disabled={!composerUsable}>{tr("common.send")}</button>
            )}
          </footer>
          {/* 录音条只挂在**录音所属的那个会话**上：切走时录音已暂停留底，回来才重新露出。 */}
          {recordingHere && (
            <div className="voice-recorder-bar" role="dialog" aria-label={tr("chat.voice.recording")}>
              <span className="rd keep-anim" />
              {/* §12 倒数：4:50 起 timer 变红 + 显"还剩 Ns"，到 5:00 自动送出（onMaxReached）。 */}
              <span className={`rec-timer${recordElapsed >= VOICE_COUNTDOWN_START_MS ? " over" : ""}`}>
                {Math.floor(recordElapsed / 60000)}:{String(Math.floor(recordElapsed / 1000) % 60).padStart(2, "0")}
                {recordElapsed >= VOICE_COUNTDOWN_START_MS && recordElapsed < VOICE_MAX_MS &&
                  <span className="rec-countdown"> · {tr("chat.voice.remaining", { seconds: Math.max(0, Math.ceil((VOICE_MAX_MS - recordElapsed) / 1000)) })}</span>}
              </span>
              <span className="rec-livewave" aria-hidden>
                {recordAmps.map((a, i) => (
                  <i key={i} style={{ height: `${Math.max(3, a * 20)}px` }} />
                ))}
              </span>
              <button className="rec-btn cancel" type="button" onClick={cancelVoice}>{tr("common.cancel")}</button>
              <button className="rec-btn cancel" type="button" onClick={togglePauseVoice}>{voicePaused ? tr("common.resume") : tr("common.pause")}</button>
              {/* 暂停后才给预听（iOS 锁定条同款）：录制中拿到的片段随时会被续上，边录边听没有意义。 */}
              {voicePaused && (
                <button className="rec-btn preview" type="button" onClick={togglePreview}>
                  {previewing ? tr("common.stop") : tr("chat.voice.preview")}
                </button>
              )}
              <button className="rec-btn send" type="button" onClick={stopVoiceSend}>{tr("common.send")}</button>
              <span className="rec-hint" style={{ fontSize: 11, opacity: 0.7 }}>
                <kbd>Space</kbd> {tr("common.pause")} · <kbd>Esc</kbd> {tr("common.cancel")} · <kbd>Enter</kbd> {tr("common.send")}
              </span>
            </div>
          )}
        </>
      )}
    </>
  );
}
