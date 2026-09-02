// Composer：聊天列底部区——跳底钮 / 拉黑提示 / 编辑态条 / 引用回复条 / 多选工具栏 / 粘贴预览条 / 附件弹层 / @提及面板 / 输入框+发送。
// 阶段 3 从 App.tsx 整块平移（JSX 逐字一致，行为保持型，CODING_STYLE §7）。发送/粘贴/@解析等**逻辑仍在 App**
// （与 msgsByConv/pendingFiles/mention 状态互咬，§7「胶水别硬抽」），本组件只出 JSX：
// - 稳定动作与 ref（send/pickFile/onInputChange/composerRef…皆 useCallback/useRef，定义均在 login 早退前）走 ChatActionsContext；
// - reactive 值（input/replyTo/editingMsg/selectMode/pastedImages/mentionRows…）走 props。
// 护栏：Composer.test.tsx + App.smoke.test.tsx（发消息主链路）。
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Bookmark, Forward, Mic, Trash2, type LucideIcon, IdCard } from "lucide-react";
import type { ChatMessage } from "../sdk/protocol";
import type { AttachmentPickMode } from "../attachments";
import { VoiceRecorder, voiceRecordingSupported, VOICE_COUNTDOWN_START_MS, VOICE_MAX_MS } from "../voiceRecorder";
import type { DownloadState } from "../download";
import { replyPreviewOf } from "../messageContent";
import { FileTypeIcon } from "../FileTypeIcon";
import { Avatar } from "./Avatar";
import { QuoteThumb } from "./QuoteThumb";
import { useChatActions } from "../ChatActionsContext";
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
  const {
    convId, peer, uid, isGroupChat, peerLabel, peerBlocked, input, sendKey, composerMuteReason, showJump, jumpCount, jumpCapped,
    editingMsg, replyTo, selectMode, selected, pastedImages, attachPanel, attachItems,
    mentionQuery, mentionFilter, mentionRows, mentionActive, mediaGate, senderLabel, onMentionNavKey,
  } = p;
  const {
    setInput, locateInChat, jumpToBottom, unblock, setEditingMsg, setReplyTo, exitSelectMode, forwardSelected, favoriteSelected, deleteSelected,
    removePastedImage, cancelAttachClose, scheduleAttachClose, setAttachPanel, pickFile, openFavoritesPick, openContactPicker, onFilePicked,
    setMentionFilter, pickMention, setMentionActive, onInputChange, onComposerPaste, send,
    sendVoice, setToast,
    attachAnchorRef, fileInputRef, mentionPanelRef, mentionActiveRef, composerRef,
  } = useChatActions();
  const [delConfirm, setDelConfirm] = useState(false); // 多选删除二次确认气泡（「仅为我删除」）
  // Web P1 语音：AAC 兼容探测 → 麦克风入口置灰/激活；点击开录 → 输入栏 morph 成录制条。
  // ChatActions.sendVoice 上传+发送；Space/Esc/Enter 快捷键在录制条 focus 时接管。
  const voiceProbe = useMemo(() => voiceRecordingSupported(), []);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const [recordAmps, setRecordAmps] = useState<number[]>([]);
  const [voicePaused, setVoicePaused] = useState(false);

  const startVoiceRecord = useCallback(async () => {
    if (recording || !voiceProbe.supported) return;
    setRecording(true); setRecordElapsed(0); setRecordAmps([]); setVoicePaused(false);
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
          void sendVoice(res.blob, name, res.waveformBase64, res.durationMs);
        },
        onCancel: (reason) => {
          setRecording(false);
          recorderRef.current = null;
          if (reason === "tooShort") setToast("说话时间太短");
          else if (reason === "error") setToast("录音失败，请重试");
        },
        onMaxReached: () => {
          // §12 硬闸：桌面天然锁定 → 自动送出；toast 告知用户"到点已自动发送"（分钟数由常量派生）。
          setToast(`语音已达 ${VOICE_MAX_MS / 60000} 分钟上限，自动发送`);
        },
      });
    } catch (e) {
      setRecording(false);
      recorderRef.current = null;
      setToast((e as Error).message || "无法开始录音");
    }
  }, [recording, voiceProbe.supported, sendVoice, setToast]);

  const stopVoiceSend = useCallback(() => { recorderRef.current?.stopAndSend(); }, []);
  const cancelVoice = useCallback(() => { recorderRef.current?.cancel(); }, []);
  const togglePauseVoice = useCallback(() => {
    const r = recorderRef.current; if (!r) return;
    if (r.isPaused()) { r.resume(); setVoicePaused(false); }
    else { r.pause(); setVoicePaused(true); }
  }, []);

  // Space 暂停/继续、Esc 取消、Enter 发送（录制中生效，防冲突聊天列表滚动）。
  useEffect(() => {
    if (!recording) return;
    const onKey: (e: Event) => void = (e) => {
      const k = e as unknown as { key: string; code?: string; preventDefault(): void };
      if (k.key === "Escape") { k.preventDefault(); cancelVoice(); }
      else if (k.key === "Enter") { k.preventDefault(); stopVoiceSend(); }
      else if (k.key === " " || k.code === "Space") { k.preventDefault(); togglePauseVoice(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording, cancelVoice, stopVoiceSend, togglePauseVoice]);

  return (
    <>
      {showJump && convId && (
        <button className="jump-btn" onClick={jumpToBottom} title="跳到最新消息">
          ↓{jumpCount > 0 && <span className="jump-badge">{unreadBadgeText(jumpCount, jumpCapped)}</span>}
        </button>
      )}
      {peerBlocked && peer && (
        // 微信式单向：拉黑者仍可发、对方能收到；这里只给一条非阻断提示 + 解除入口，不禁用输入。
        <div className="block-hint">已将对方加入黑名单（TA 发来的消息会被拒收）<button className="link-inline" onClick={() => void unblock(peer)}>解除拉黑</button></div>
      )}
      {editingMsg && (
        // 编辑态条（M4-5）：输入框上方显示"编辑消息" + 取消（恢复普通发送）。
        // 点预览区 → 定位到正在编辑的原消息（与引用条一致）；✕ 独立在点击区外。
        <div className="reply-compose">
          <div className="reply-compose-hit" onClick={() => locateInChat(editingMsg.convId, editingMsg.convSeq)} title="跳到原消息">
            <div className="reply-compose-text">
              <span className="reply-who">编辑消息</span>
              <span className="reply-snippet">{(editingMsg.content || "").slice(0, 80)}</span>
            </div>
          </div>
          <button className="reply-cancel" onClick={() => { setEditingMsg(null); setInput(""); }} title="取消编辑">✕</button>
        </div>
      )}
      {replyTo && (
        // 引用回复条（M4-2）：输入框上方显示被引用消息预览 + 取消；图片/视频显示小缩略图。
        // 点预览区（缩略图+文字，不含 ✕）→ 定位到被引用的原消息（与 iOS 一致）；✕ 独立在点击区外。
        <div className="reply-compose">
          <div className="reply-compose-hit" onClick={() => locateInChat(replyTo.convId, replyTo.convSeq)} title="跳到原消息">
            {/* 图说消息（带 caption）：引用预览只显文本，不挂缩略图（与气泡内引用条一致，简化少出错）。 */}
            {!replyTo.caption && <QuoteThumb m={replyTo} gated={!!mediaGate(replyTo)} />}
            <div className="reply-compose-text">
              <span className="reply-who">回复 {replyTo.from === uid ? "自己" : (isGroupChat ? senderLabel(replyTo) : peerLabel)}</span>
              <span className="reply-snippet">{replyPreviewOf(replyTo)}</span>
            </div>
          </div>
          <button className="reply-cancel" onClick={() => setReplyTo(null)} title="取消引用">✕</button>
        </div>
      )}
      {selectMode ? (
        // 多选态工具栏（M4-3）：批量 转发/收藏/删除——独立圆形 Liquid Glass 按钮、无工具栏背景（与 iOS 拉齐）。
        <footer className="select-bar">
          <button className="link-inline" onClick={() => { setDelConfirm(false); exitSelectMode(); }}>取消</button>
          <span className="select-count">已选 {selected.size}</span>
          <button className="sel-action" title="转发" aria-label="转发" disabled={selected.size === 0} onClick={forwardSelected}><Forward size={22} aria-hidden="true" /></button>
          <button className="sel-action" title="收藏" aria-label="收藏" disabled={selected.size === 0} onClick={favoriteSelected}><Bookmark size={22} aria-hidden="true" /></button>
          {/* 删除：点按不直接删，先在按钮**上方**弹「仅为我删除」确认气泡，点它才删（与 iOS 拉齐）。 */}
          <span className="sel-del-wrap">
            <button className="sel-action danger" title="删除" aria-label="删除" disabled={selected.size === 0} onClick={() => setDelConfirm(true)}><Trash2 size={22} aria-hidden="true" /></button>
            {delConfirm && selected.size > 0 && (
              <>
                <span className="sel-del-backdrop" onClick={() => setDelConfirm(false)} />
                <span className="sel-del-pop" role="menu">
                  <button className="sel-del-only" role="menuitem" onClick={() => { setDelConfirm(false); deleteSelected(); }}>仅为我删除</button>
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
                    <img src={pi.url} alt="待发送图片" />
                    <button className="paste-remove" title="移除" onClick={() => removePastedImage(i)}>✕</button>
                  </div>
                ) : pi.kind === "video" ? (
                  // 视频：用 <video> 显首帧（muted+metadata），角标示意可播放；发送仍与图片同批走 sendMediaBatch。
                  <div key={pi.url} className="paste-thumb paste-video">
                    <video src={pi.url} muted preload="metadata" playsInline />
                    <span className="paste-video-badge" aria-hidden>▶</span>
                    <button className="paste-remove" title="移除" onClick={() => removePastedImage(i)}>✕</button>
                  </div>
                ) : (
                  <div key={pi.url} className="paste-thumb paste-file">
                    <FileTypeIcon name={pi.file.name} size={26} />
                    <span className="paste-file-name" title={pi.file.name}>{pi.file.name}</span>
                    <button className="paste-remove" title="移除" onClick={() => removePastedImage(i)}>✕</button>
                  </div>
                )
              ))}
            </div>
          )}
          <footer>
            <div className="attach-anchor" ref={attachAnchorRef}
              onMouseEnter={() => { cancelAttachClose(); if (convId) setAttachPanel(true); }}
              onMouseLeave={scheduleAttachClose}>
              <button className="attach-btn" disabled={!convId} title="附件"
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
                    <span>收藏</span>
                  </button>
                  {/* 个人名片（CONTACT_CARD_DESIGN §8.1 入口 ①）：选好友 → 二次确认 → 发进当前会话。 */}
                  <button className="attach-item" role="menuitem" onClick={openContactPicker}>
                    <IdCard size={24} aria-hidden="true" />
                    <span>个人名片</span>
                  </button>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFilePicked} />
            {/* @提及面板（M4-8，仅群聊）：贴输入框上方的内联下拉，边打字边过滤。
                支持 ↑/↓ 移动、Enter/Tab 选中、Esc 关闭（见 composer 的 onKeyDown）。
                「@所有人」仅群主/管理员可见——普通成员整行不渲染（服务端另有角色校验）。 */}
            {mentionQuery !== null && (
              <div className="mention-panel" role="listbox" aria-label="提醒谁" ref={mentionPanelRef}>
                {/* 顶部搜索框＝独立搜索：从空开始、不被消息框 @后文字回填；在此打字则以它为准过滤（否则列表跟随 @后字符）。 */}
                <input className="mention-search" value={mentionFilter} placeholder="搜索成员" aria-label="搜索成员"
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
                    {r.role === "owner" && <span className="role-badge owner">群主</span>}
                    {r.role === "admin" && <span className="role-badge">管理员</span>}
                  </button>
                )) : <div className="mention-empty">无匹配成员</div>}
              </div>
            )}
            <textarea ref={composerRef} value={input} rows={1} disabled={!convId || composerMuteReason !== null}
              placeholder={composerMuteReason || (convId ? (sendKey === "cmd" ? "输入消息，Cmd+Enter 发送…" : "输入消息，回车发送…") : "先选择左侧的会话…")}
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
              // 空框：显麦克风（P1）。不支持录制的浏览器（Chrome/Firefox 默认不支持 audio/mp4）→ 置灰 + tooltip。
              <button className="mic-btn"
                      disabled={!convId || composerMuteReason !== null || !voiceProbe.supported}
                      title={voiceProbe.supported ? "点击开始录音" : "当前浏览器不支持录制语音，可在 App 内发送"}
                      onClick={startVoiceRecord}>
                <Mic size={18} aria-hidden="true" />
              </button>
            ) : (
              <button onClick={send} disabled={!convId || composerMuteReason !== null}>发送</button>
            )}
          </footer>
          {recording && (
            <div className="voice-recorder-bar" role="dialog" aria-label="录音中">
              <span className="rd" />
              {/* §12 倒数：4:50 起 timer 变红 + 显"还剩 Ns"，到 5:00 自动送出（onMaxReached）。 */}
              <span className={`rec-timer${recordElapsed >= VOICE_COUNTDOWN_START_MS ? " over" : ""}`}>
                {Math.floor(recordElapsed / 60000)}:{String(Math.floor(recordElapsed / 1000) % 60).padStart(2, "0")}
                {recordElapsed >= VOICE_COUNTDOWN_START_MS && recordElapsed < VOICE_MAX_MS &&
                  <span className="rec-countdown"> · 还剩 {Math.max(0, Math.ceil((VOICE_MAX_MS - recordElapsed) / 1000))}s</span>}
              </span>
              <span className="rec-livewave" aria-hidden>
                {recordAmps.map((a, i) => (
                  <i key={i} style={{ height: `${Math.max(3, a * 20)}px` }} />
                ))}
              </span>
              <button className="rec-btn cancel" type="button" onClick={cancelVoice}>取消</button>
              <button className="rec-btn cancel" type="button" onClick={togglePauseVoice}>{voicePaused ? "继续" : "暂停"}</button>
              <button className="rec-btn send" type="button" onClick={stopVoiceSend}>发送</button>
              <span className="rec-hint" style={{ fontSize: 11, opacity: 0.7 }}>
                <kbd>Space</kbd> 暂停 · <kbd>Esc</kbd> 取消 · <kbd>Enter</kbd> 发送
              </span>
            </div>
          )}
        </>
      )}
    </>
  );
}
