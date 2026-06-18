// 数据驱动的可扩展菜单注册表（消息右键菜单 / 会话右键菜单）。
// 设计目标：新增一个菜单项 = 往数组里 append 一条，无需改 render 代码。
// iOS 端可对照本文件保持菜单项与顺序一致（parity）。
import type { ChatMessage, Conversation } from "./sdk/protocol";
import type { LucideIcon } from "lucide-react";
import {
  Copy, Reply, Forward, Bookmark, Undo2, CheckSquare, Languages, Trash2, Flag,
  Pin, BellOff, CheckCheck,
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

/** 消息菜单的真实处理器集合：copy/delete/report* / markRead 接真实实现，其余统一走 comingSoon。 */
export interface MessageHandlers {
  copy: (m: ChatMessage) => void;
  delete: (m: ChatMessage) => void;
  reportMsg: (m: ChatMessage) => void;
  reportUser: (m: ChatMessage) => void;
  comingSoon: (label: string) => void;
}

/** 会话菜单的真实处理器集合：markRead/delete 接真实实现，其余走 comingSoon。 */
export interface ConversationHandlers {
  markRead: (c: Conversation) => void;
  delete: (c: Conversation) => void;
  comingSoon: (label: string) => void;
}

/**
 * 构建消息右键菜单项（固定顺序，与 iOS messageActionsForMessage:mine: 对齐）：
 * 复制 / 引用 / 转发 / 收藏 / 撤回 / 多选 / 翻译 / 举报消息 / 举报发送者 / 删除。
 * 危险项「删除」放最后（destructive-last，防误触，两端一致）。未接后端的项调用 h.comingSoon(label) 弹"开发中"提示。
 */
export function buildMessageActions(h: MessageHandlers): MenuAction<MessageCtx>[] {
  return [
    { id: "copy", label: "复制", icon: Copy, visible: (c) => isText(c.m), run: (c) => h.copy(c.m) },
    { id: "reply", label: "引用", icon: Reply, visible: () => true, run: () => h.comingSoon("引用") },
    { id: "forward", label: "转发", icon: Forward, visible: () => true, run: () => h.comingSoon("转发") },
    { id: "favorite", label: "收藏", icon: Bookmark, visible: () => true, run: () => h.comingSoon("收藏") },
    { id: "recall", label: "撤回", icon: Undo2, visible: (c) => c.m.from === c.uid && c.m.convSeq > 0, run: () => h.comingSoon("撤回") },
    { id: "multiSelect", label: "多选", icon: CheckSquare, visible: () => true, run: () => h.comingSoon("多选") },
    { id: "translate", label: "翻译", icon: Languages, visible: (c) => isText(c.m), run: () => h.comingSoon("翻译") },
    { id: "reportMsg", label: "举报消息", icon: Flag, visible: (c) => c.m.from !== c.uid && c.m.convSeq > 0, run: (c) => h.reportMsg(c.m) },
    { id: "reportUser", label: "举报发送者", icon: Flag, visible: (c) => c.m.from !== c.uid, run: (c) => h.reportUser(c.m) },
    { id: "delete", label: "删除", icon: Trash2, danger: true, visible: () => true, run: (c) => h.delete(c.m) },
  ];
}

/**
 * 构建会话右键菜单项（固定顺序）：置顶 / 静音 / 设为已读 / 删除。
 * 设为已读仅在有未读时显示；未接后端的项走 comingSoon。
 */
export function buildConversationActions(h: ConversationHandlers): MenuAction<ConvCtx>[] {
  return [
    { id: "pin", label: "置顶", icon: Pin, visible: () => true, run: () => h.comingSoon("置顶") },
    { id: "mute", label: "静音", icon: BellOff, visible: () => true, run: () => h.comingSoon("静音") },
    { id: "markRead", label: "设为已读", icon: CheckCheck, visible: (c) => c.c.unread > 0, run: (c) => h.markRead(c.c) },
    { id: "delete", label: "删除", icon: Trash2, danger: true, visible: () => true, run: (c) => h.delete(c.c) },
  ];
}
