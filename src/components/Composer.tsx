// Composer：聊天列底部区——跳底钮 / 拉黑提示 / 编辑态条 / 引用回复条 / 多选工具栏 / 粘贴预览条 / 附件弹层 / @提及面板 / 输入框+发送。
// 阶段 3 从 App.tsx 整块平移（JSX 逐字一致，行为保持型，CODING_STYLE §7）。发送/粘贴/@解析等**逻辑仍在 App**
// （与 msgsByConv/pendingFiles/mention 状态互咬，§7「胶水别硬抽」），本组件只出 JSX：
// - 稳定动作与 ref（send/pickFile/onInputChange/composerRef…皆 useCallback/useRef，定义均在 login 早退前）走 ChatActionsContext；
// - reactive 值（input/replyTo/editingMsg/selectMode/pastedImages/mentionRows…）走 props。
// 护栏：Composer.test.tsx + App.smoke.test.tsx（发消息主链路）。
import type { KeyboardEvent } from "react";
import { Bookmark, type LucideIcon } from "lucide-react";
import type { ChatMessage } from "../sdk/protocol";
import type { AttachmentPickMode } from "../attachments";
import type { DownloadState } from "../download";
import { replyPreviewOf } from "../messageContent";
import { FileTypeIcon } from "../FileTypeIcon";
import { Avatar } from "./Avatar";
import { QuoteThumb } from "./QuoteThumb";
import { useChatActions } from "../ChatActionsContext";

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
    convId, peer, uid, isGroupChat, peerLabel, peerBlocked, input, sendKey, composerMuteReason, showJump, jumpCount,
    editingMsg, replyTo, selectMode, selected, pastedImages, attachPanel, attachItems,
    mentionQuery, mentionFilter, mentionRows, mentionActive, mediaGate, senderLabel, onMentionNavKey,
  } = p;
  const {
    setInput, locateInChat, jumpToBottom, unblock, setEditingMsg, setReplyTo, exitSelectMode, forwardSelected, deleteSelected,
    removePastedImage, cancelAttachClose, scheduleAttachClose, setAttachPanel, pickFile, openFavoritesPick, onFilePicked,
    setMentionFilter, pickMention, setMentionActive, onInputChange, onComposerPaste, send,
    attachAnchorRef, fileInputRef, mentionPanelRef, mentionActiveRef, composerRef,
  } = useChatActions();
  return (
    <>
      {showJump && convId && (
        <button className="jump-btn" onClick={jumpToBottom} title="跳到最新消息">
          ↓{jumpCount > 0 && <span className="jump-badge">{jumpCount > 99 ? "99+" : jumpCount}</span>}
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
        // 多选态工具栏（M4-3）：批量 转发/删除，替换输入区。
        <footer className="select-bar">
          <button className="link-inline" onClick={exitSelectMode}>取消</button>
          <span className="select-count">已选 {selected.size}</span>
          <button disabled={selected.size === 0} onClick={forwardSelected}>转发</button>
          <button className="danger" disabled={selected.size === 0} onClick={deleteSelected}>删除</button>
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
                    <span className="mention-name">{r.label}</span>
                    {r.note && <span className="role-badge">{r.note}</span>}
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
            <button onClick={send} disabled={!convId || composerMuteReason !== null}>发送</button>
          </footer>
        </>
      )}
    </>
  );
}
