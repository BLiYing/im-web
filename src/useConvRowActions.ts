// 会话行的单条操作：设为已读 / 标为未读 / 置顶 / 删除（会话列表右键菜单与聊天页菜单共用）。
// 从 App.tsx 抽出（CODING_STYLE §7 决策树①；App.tsx 是只准降不准升的历史欠账文件）。副作用依赖全部注入。
import { useCallback } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { Conversation } from "./sdk/protocol";
import { t } from "./i18n";

export interface UseConvRowActionsOptions {
  clientRef: React.MutableRefObject<IMClient | null>;
  refreshConversations: () => Promise<Conversation[]>;
  setToast: (msg: string | null) => void;
  /** 动作开始时关掉会话行右键菜单。 */
  closeConvMenu: () => void;
  /** 当前打开的会话 id：删的是它就退出该会话。 */
  currentConvRef: React.MutableRefObject<string>;
  /** 退出当前会话（内部会刷新会话列表）。 */
  deselect: () => void;
}

export function useConvRowActions(o: UseConvRowActionsOptions) {
  const { clientRef, refreshConversations, setToast, closeConvMenu, currentConvRef, deselect } = o;

  // 会话"设为已读"：推进已读位点（清未读数）+ 清除手动"标未读"标记，再刷新列表。
  const markReadConv = useCallback((c: Conversation) => {
    closeConvMenu();
    void (async () => {
      try {
        if (c.unread > 0) clientRef.current?.markRead(c.conv_id, c.latest_conv_seq);
        if (c.marked_unread) {
          await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: c.pinned_at ?? 0, muted: !!c.muted, marked_unread: false });
        }
        await refreshConversations();
      } catch (e) { setToast(t("common.error.action_failed", { detail: (e as Error).message })); }
    })();
  }, [clientRef, closeConvMenu, refreshConversations, setToast]);

  // 会话"标为未读"：手动置红点（不改已读位点，不计数）。
  const markUnreadConv = useCallback((c: Conversation) => {
    closeConvMenu();
    void (async () => {
      try {
        await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: c.pinned_at ?? 0, muted: !!c.muted, marked_unread: true });
        await refreshConversations();
      } catch (e) { setToast(t("common.error.action_failed", { detail: (e as Error).message })); }
    })();
  }, [clientRef, closeConvMenu, refreshConversations, setToast]);

  // 会话置顶/取消置顶：pinned_at=现在/0（后端据此把置顶会话排在列表顶）。
  const setConvPinned = useCallback((c: Conversation, pinned: boolean) => {
    closeConvMenu();
    void (async () => {
      try {
        await clientRef.current?.updateConvSettings(c.conv_id, { pinned_at: pinned ? Date.now() : 0, muted: !!c.muted, marked_unread: !!c.marked_unread });
        await refreshConversations();
      } catch (e) { setToast(t("common.error.action_failed", { detail: (e as Error).message })); }
    })();
  }, [clientRef, closeConvMenu, refreshConversations, setToast]);

  // 删除会话（仅本人，后端记 cleared_at 不删消息）：若删的是当前打开会话则退出，否则刷新列表。
  const deleteConv = useCallback((c: Conversation) => {
    closeConvMenu();
    void (async () => {
      try {
        await clientRef.current?.deleteConversation(c.conv_id);
        if (currentConvRef.current === c.conv_id) deselect(); // deselect 内部会 refreshConversations
        else await refreshConversations();
      } catch (e) { setToast(t("conv.error.delete_failed_detail", { detail: (e as Error).message })); }
    })();
  }, [clientRef, closeConvMenu, currentConvRef, deselect, refreshConversations, setToast]);

  return { markReadConv, markUnreadConv, setConvPinned, deleteConv };
}
