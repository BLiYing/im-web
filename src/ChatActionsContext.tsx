// 聊天动作 Context（阶段 1 · 抽 MessageList 用）：收拢消息行要用、且**定义于 App login 早退之前**的稳定动作
// （useState setter / ref / useCallback）。App 侧 `useMemo` 一次、依赖为空：函数成员经 useEvent 包成恒定身份
// （它们的 useCallback 本身依赖 input/dlStates/uploadProgress 等高频 state，裸放会让 Context 值每次按键重建），
// 消费者=聊天列的组件（MessageList，后续 Composer）。**不放 reactive 值**（messages/selectMode…那些走 props）。
// 与 AppServicesContext 分开：那边是「永不重建」的应用级服务；这边的 onGateTap/onMediaBubbleTap 等
// 依赖下载态会重建（靠 useEvent 抹平），混进去会破坏应用级 memo 的语义（CODING_STYLE §7）。
// setter 一律 Dispatch<SetStateAction<T>>：保留 updater 形式，消费者不必从 props 读旧值再算（避免陈旧闭包）。
import { createContext, useContext, type ClipboardEvent, type ChangeEvent, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { ChatMessage } from "./sdk/protocol";
import type { LinkPreview } from "./components/LinkCard";
import type { ChatRecord } from "./messageContent";
import type { AttachmentPickMode } from "./attachments";

export interface ChatActions {
  setMenu: Dispatch<SetStateAction<{ x: number; y: number; m: ChatMessage } | null>>;
  setViewer: Dispatch<SetStateAction<{ m: ChatMessage; fromGallery?: boolean } | null>>;
  setInput: Dispatch<SetStateAction<string>>;
  setRecordStack: Dispatch<SetStateAction<ChatRecord[]>>;
  setToast: (msg: string | null) => void;
  locateInChat: (cid: string, seq: number, opts?: { earliest?: boolean }) => void;
  onGateTap: (m: ChatMessage) => void;
  onMediaBubbleTap: (m: ChatMessage, openViewer: () => void) => void;
  openReadyFile: (m: ChatMessage) => Promise<void>;
  onPassiveMediaError: (m: ChatMessage) => Promise<void>;
  retryUpload: (m: ChatMessage) => void;
  /** 发送失败红❗点击：按 resendPolicyFor 分派重发。相册传该组任一成员 + 当前会话消息表（整组重发）。 */
  resendMessage: (m: ChatMessage, all?: ChatMessage[]) => void;
  toggleUploadPause: (m: ChatMessage) => boolean;
  toggleSelected: (seq: number) => void;
  fetchLinkPreview: (url: string) => Promise<LinkPreview>;
  onMediaLoad: () => void;
  pendingFilesRef: MutableRefObject<Map<string, { file: File; mode: AttachmentPickMode; convId: string; groupId?: string; caption?: string; mentions?: string[]; mentionAll?: boolean }>>;
  // —— 阶段 3 · Composer（皆 useCallback / setter / useRef，定义均在 login 早退之前）——
  jumpToBottom: () => void;
  unblock: (peer: string) => Promise<void>;
  setEditingMsg: Dispatch<SetStateAction<ChatMessage | null>>;
  setReplyTo: Dispatch<SetStateAction<ChatMessage | null>>;
  exitSelectMode: () => void;
  forwardSelected: () => void;
  deleteSelected: () => void;
  favoriteSelected: () => void; // 多选批量收藏（与 iOS 拉齐）
  reportSelected: () => void;   // 多选批量举报（所选须同一发送者；2026-09-06，与 iOS 拉齐）
  removePastedImage: (i: number) => void;
  cancelAttachClose: () => void;
  scheduleAttachClose: () => void;
  setAttachPanel: Dispatch<SetStateAction<boolean>>;
  pickFile: (mode: AttachmentPickMode, accept: string) => void;
  openFavoritesPick: () => void;
  /** 附件面板「个人名片」：打开好友选择弹窗（见 useContactShare）。 */
  openContactPicker: () => void;
  onFilePicked: (e: ChangeEvent<HTMLInputElement>) => void;
  setMentionFilter: Dispatch<SetStateAction<string>>;
  pickMention: (displayName: string, userId: string | null) => void;
  setMentionActive: Dispatch<SetStateAction<number>>;
  onInputChange: (val: string) => void;
  onComposerPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** 文件进预览条（粘贴与拖入共用；useCallback 空依赖，身份恒定，可直接进 Context）。 */
  addPastedFiles: (files: File[], source?: "paste" | "drop") => void;
  send: () => void;
  /** Web P1 语音：Composer 录制完毕后回调 App 走 uploadVoice + sendMedia contentType=voice。 */
  /** targetConvId：这段语音录制时所属的会话（录音条长驻，切会话后 convId 已经不是它了）。 */
  sendVoice: (blob: Blob, fileName: string, waveformBase64: string, durationMs: number, targetConvId?: string) => Promise<void>;
  attachAnchorRef: RefObject<HTMLDivElement>;
  fileInputRef: RefObject<HTMLInputElement>;
  mentionPanelRef: RefObject<HTMLDivElement>;
  mentionActiveRef: RefObject<HTMLButtonElement>;
  composerRef: RefObject<HTMLTextAreaElement>;
}

const ChatActionsContext = createContext<ChatActions | null>(null);
export const ChatActionsProvider = ChatActionsContext.Provider;

export function useChatActions(): ChatActions {
  const ctx = useContext(ChatActionsContext);
  if (!ctx) throw new Error("useChatActions 必须在 <ChatActionsProvider> 内使用");
  return ctx;
}
