// 会话免打扰：状态（时长二级菜单）+ 唯一写路径（NOTIFICATIONS_P1_DESIGN §4/§5）。
// CODING_STYLE §7 决策树①：自己有状态（convMuteMenu）+ 一组操作（setConvMuted/requestMute）→ 抽 Hook，
// 别往 App.tsx 堆（App.tsx 是历史欠账的上帝文件，新功能默认进新文件）。
// 副作用依赖（IM client、吐司、刷新列表、关闭一级会话菜单）全部注入，Hook 本身不摸任何全局。
import { useCallback, useState } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { Conversation } from "./sdk/protocol";
import { t } from "./i18n";

export interface ConvMuteMenuState { x: number; y: number; c: Conversation }

export interface UseConvMuteOptions {
  clientRef: React.MutableRefObject<IMClient | null>;
  refreshConversations: () => Promise<Conversation[]> | Promise<void>;
  setToast: (msg: string) => void;
  /** 打开时长子菜单前先关掉一级会话右键菜单（会话列表右键「免打扰」→ 展开二级菜单场景）。 */
  closeConvMenu: () => void;
}

export interface UseConvMute {
  /** 唯一写路径（NOTIFICATIONS_P1_DESIGN §6.4）：`muteUntil` 省略时让服务端按缺省规则处理
   *  （取消免打扰服务端一律清 0；只想原样带回 `muted` 的调用方——置顶/标未读——不要传本参数，
   *  否则会把用户正在进行的定时免打扰意外拉成永久，§5.2 明文的坑）。 */
  setConvMuted: (c: Conversation, muted: boolean, muteUntil?: number) => void;
  /** 免打扰时长二级菜单的锚点状态；为 null 时不渲染。 */
  convMuteMenu: ConvMuteMenuState | null;
  setConvMuteMenu: (v: ConvMuteMenuState | null) => void;
  /** 会话列表右键「免打扰」：不直接执行，先弹时长子菜单（对齐 UX 稿 04 frame E）。
   *  已免打扰时该菜单项本就不可见（走「取消免打扰」直接调 setConvMuted(c,false)），走不到这里。 */
  requestMute: (c: Conversation, x: number, y: number) => void;
}

export function useConvMute(opts: UseConvMuteOptions): UseConvMute {
  const { clientRef, refreshConversations, setToast, closeConvMenu } = opts;
  const [convMuteMenu, setConvMuteMenu] = useState<ConvMuteMenuState | null>(null);

  const setConvMuted = useCallback((c: Conversation, muted: boolean, muteUntil?: number) => {
    closeConvMenu();
    setConvMuteMenu(null);
    void (async () => {
      try {
        await clientRef.current?.updateConvSettings(c.conv_id, {
          pinned_at: c.pinned_at ?? 0, muted, marked_unread: !!c.marked_unread,
          ...(muteUntil !== undefined ? { mute_until: muteUntil } : {}),
        });
        await refreshConversations();
      } catch (e) { setToast(t("common.error.action_failed", { detail: (e as Error).message })); }
    })();
  }, [clientRef, refreshConversations, setToast, closeConvMenu]);

  const requestMute = useCallback((c: Conversation, x: number, y: number) => {
    closeConvMenu();
    setConvMuteMenu({ x, y, c });
  }, [closeConvMenu]);

  return { setConvMuted, convMuteMenu, setConvMuteMenu, requestMute };
}
