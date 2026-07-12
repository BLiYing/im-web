// 数据驱动的可扩展菜单注册表（消息右键菜单 / 会话右键菜单）。
// 设计目标：新增一个菜单项 = 往数组里 append 一条，无需改 render 代码。
// iOS 端可对照本文件保持菜单项与顺序一致（parity）。
import type { ChatMessage, Conversation } from "./sdk/protocol";
import type { LucideIcon } from "lucide-react";
import {
  Copy, Reply, Forward, Bookmark, Undo2, CheckSquare, Languages, Trash2, Flag,
  Pin, PinOff, Bell, BellOff, CheckCheck, Circle, Pencil,
} from "lucide-react";

/** 一个菜单项：id 稳定标识、label 文案、icon 图标、danger 红色危险样式、visible 按上下文决定是否显示、run 执行。 */
export type MenuAction<C> = {
  id: string;
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  visible: (c: C) => boolean;
  run: (c: C) => void;
};

/** 消息菜单上下文：当前消息 + 本人 uid（判断"我发的/对方发的"）。 */
export type MessageCtx = { m: ChatMessage; uid: string };

/** 会话菜单上下文：当前会话。 */
export type ConvCtx = { c: Conversation };

/** 是否文本消息（部分操作如复制/翻译仅对文本可用）。 */
function isText(m: ChatMessage): boolean {
  return m.contentType === "text" && !!m.content;
}

/** 撤回可见时间窗（微信式 2min，与后端 Hub.recallWindow 对齐；服务端为准，此处仅避免必然失败的入口）。 */
export const RECALL_WINDOW_MS = 2 * 60 * 1000;

/** 是否可撤回：本人已确认消息、未撤回、在时间窗内。 */
function canRecall(m: ChatMessage, uid: string): boolean {
  return m.from === uid && m.convSeq > 0 && !m.recalledAt && Date.now() - m.timestamp <= RECALL_WINDOW_MS;
}

/** 消息菜单的真实处理器集合：copy/delete/report* / markRead 接真实实现，其余统一走 comingSoon。 */
export interface MessageHandlers {
  copy: (m: ChatMessage) => void;
  reply: (m: ChatMessage) => void;
  forward: (m: ChatMessage) => void;
  favorite: (m: ChatMessage) => void;
  edit: (m: ChatMessage) => void;
  translate: (m: ChatMessage) => void;
  multiSelect: (m: ChatMessage) => void;
  recall: (m: ChatMessage) => void;
  delete: (m: ChatMessage) => void;
  reportMsg: (m: ChatMessage) => void;
  reportUser: (m: ChatMessage) => void;
  comingSoon: (label: string) => void;
}

/** 会话菜单的真实处理器集合（M4.5 全部接后端）：置顶/免打扰切换、标已读/未读、删除会话。 */
export interface ConversationHandlers {
  setPinned: (c: Conversation, pinned: boolean) => void;
  setMuted: (c: Conversation, muted: boolean) => void;
  markRead: (c: Conversation) => void;
  markUnread: (c: Conversation) => void;
  delete: (c: Conversation) => void;
}

/**
 * 构建消息右键菜单项（固定顺序，与 iOS messageActionsForMessage:mine: 对齐）：
 * 复制 / 引用 / 转发 / 收藏 / 撤回 / 多选 / 翻译 / 举报消息 / 举报发送者 / 删除。
 * 危险项「删除」放最后（destructive-last，防误触，两端一致）。未接后端的项调用 h.comingSoon(label) 弹"开发中"提示。
 */
export function buildMessageActions(h: MessageHandlers): MenuAction<MessageCtx>[] {
  return [
    // 复制：文本→复制文字；图片→复制图片字节（可粘贴回输入框重发）。
    { id: "copy", label: "复制", icon: Copy, visible: (c) => isText(c.m) || c.m.contentType === "image", run: (c) => h.copy(c.m) },
    { id: "reply", label: "引用", icon: Reply, visible: (c) => !c.m.recalledAt && c.m.convSeq > 0, run: (c) => h.reply(c.m) },
    { id: "forward", label: "转发", icon: Forward, visible: (c) => !c.m.recalledAt && c.m.convSeq > 0, run: (c) => h.forward(c.m) },
    // 收藏支持 文本/图片/视频/文件/链接（快照存 content+content_type，后端通用；system/撤回除外）。
    { id: "favorite", label: "收藏", icon: Bookmark, visible: (c) => !!c.m.content && !c.m.recalledAt && c.m.contentType !== "system", run: (c) => h.favorite(c.m) },
    { id: "recall", label: "撤回", icon: Undo2, visible: (c) => canRecall(c.m, c.uid), run: (c) => h.recall(c.m) },
    { id: "edit", label: "编辑", icon: Pencil, visible: (c) => c.m.from === c.uid && isText(c.m) && !c.m.recalledAt && c.m.convSeq > 0, run: (c) => h.edit(c.m) },
    { id: "multiSelect", label: "多选", icon: CheckSquare, visible: (c) => c.m.convSeq > 0, run: (c) => h.multiSelect(c.m) },
    { id: "translate", label: "翻译", icon: Languages, visible: (c) => isText(c.m) && !c.m.recalledAt, run: (c) => h.translate(c.m) },
    { id: "reportMsg", label: "举报消息", icon: Flag, visible: (c) => c.m.from !== c.uid && c.m.convSeq > 0, run: (c) => h.reportMsg(c.m) },
    { id: "reportUser", label: "举报发送者", icon: Flag, visible: (c) => c.m.from !== c.uid, run: (c) => h.reportUser(c.m) },
    { id: "delete", label: "删除", icon: Trash2, danger: true, visible: () => true, run: (c) => h.delete(c.m) },
  ];
}

/**
 * 构建会话右键菜单项（固定顺序，M4.5 全接后端，与 iOS conversationActionsFor: 对齐）：
 * 置顶↔取消置顶 / 静音↔取消静音 / 设为已读↔标为未读 / 删除。
 * 置顶/静音/已读未读是**切换对**：每对按会话当前状态只显示其一（visible 互斥）。危险项「删除」放最后（destructive-last）。
 */
export function buildConversationActions(h: ConversationHandlers): MenuAction<ConvCtx>[] {
  return [
    { id: "pin", label: "置顶", icon: Pin, visible: (c) => !c.c.pinned_at, run: (c) => h.setPinned(c.c, true) },
    { id: "unpin", label: "取消置顶", icon: PinOff, visible: (c) => !!c.c.pinned_at, run: (c) => h.setPinned(c.c, false) },
    { id: "mute", label: "静音", icon: BellOff, visible: (c) => !c.c.muted, run: (c) => h.setMuted(c.c, true) },
    { id: "unmute", label: "取消静音", icon: Bell, visible: (c) => !!c.c.muted, run: (c) => h.setMuted(c.c, false) },
    // 已读↔未读：有未读数或被手动标未读 → 「设为已读」；否则（已读态）→ 「标为未读」。
    { id: "markRead", label: "设为已读", icon: CheckCheck, visible: (c) => c.c.unread > 0 || !!c.c.marked_unread, run: (c) => h.markRead(c.c) },
    { id: "markUnread", label: "标为未读", icon: Circle, visible: (c) => c.c.unread === 0 && !c.c.marked_unread, run: (c) => h.markUnread(c.c) },
    { id: "delete", label: "删除", icon: Trash2, danger: true, visible: () => true, run: (c) => h.delete(c.c) },
  ];
}
