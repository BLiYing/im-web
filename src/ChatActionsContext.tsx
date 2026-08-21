// 聊天动作 Context（阶段 1 · 抽 MessageList 用）：收拢消息行要用、且**定义于 App login 早退之前**的稳定动作
// （useState setter / ref / useCallback）。App 侧 `useMemo` 一次（依赖=这些回调本身，绝大多数恒定），
// 消费者=聊天列的组件（MessageList，后续 Composer）。**不放 reactive 值**（messages/selectMode…那些走 props）。
// 与 AppServicesContext 分开：那边是「永不重建」的应用级服务；这边的 onGateTap/onMediaBubbleTap 等
// 依赖下载态会偶尔重建，混进去会破坏应用级 memo 的恒定性（CODING_STYLE §7）。
import { createContext, useContext, type ClipboardEvent, type ChangeEvent, type MutableRefObject, type RefObject } from "react";
import type { ChatMessage } from "./sdk/protocol";
import type { LinkPreview } from "./components/LinkCard";
import type { ChatRecord } from "./messageContent";
import type { AttachmentPickMode } from "./attachments";

export interface ChatActions {
  setMenu: (v: { x: number; y: number; m: ChatMessage } | null) => void;
  setViewer: (v: { m: ChatMessage; fromGallery?: boolean } | null) => void;
  setInput: (v: string) => void;
  setRecordStack: (v: ChatRecord[]) => void;
  setToast: (msg: string | null) => void;
  locateInChat: (cid: string, seq: number) => void;
  onGateTap: (m: ChatMessage) => void;
  onMediaBubbleTap: (m: ChatMessage, openViewer: () => void) => void;
  openReadyFile: (m: ChatMessage) => Promise<void>;
  onPassiveMediaError: (m: ChatMessage) => Promise<void>;
  retryUpload: (m: ChatMessage) => void;
  toggleUploadPause: (m: ChatMessage) => boolean;
  toggleSelected: (seq: number) => void;
  fetchLinkPreview: (url: string) => Promise<LinkPreview>;
  onMediaLoad: () => void;
  pendingFilesRef: MutableRefObject<Map<string, { file: File; mode: AttachmentPickMode; convId: string; groupId?: string; caption?: string; mentions?: string[]; mentionAll?: boolean }>>;
  // —— 阶段 3 · Composer（皆 useCallback / setter / useRef，定义均在 login 早退之前）——
  jumpToBottom: () => void;
  unblock: (peer: string) => Promise<void>;
  setEditingMsg: (m: ChatMessage | null) => void;
  setReplyTo: (m: ChatMessage | null) => void;
  exitSelectMode: () => void;
  forwardSelected: () => void;
  deleteSelected: () => void;
  removePastedImage: (i: number) => void;
  cancelAttachClose: () => void;
  scheduleAttachClose: () => void;
  setAttachPanel: (v: boolean) => void;
  pickFile: (mode: AttachmentPickMode, accept: string) => void;
  openFavoritesPick: () => void;
  onFilePicked: (e: ChangeEvent<HTMLInputElement>) => void;
  setMentionFilter: (v: string) => void;
  pickMention: (displayName: string, userId: string | null) => void;
  setMentionActive: (i: number) => void;
  onInputChange: (val: string) => void;
  onComposerPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  send: () => void;
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
