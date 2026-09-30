// ContextMenusHost：全站右键 / ⋯ 菜单的渲染宿主（从 App.tsx 抽出，CODING_STYLE §7 决策树②
// 「一整块 UI（面板/弹窗/查看器）→ 独立展示组件」）——消息菜单、会话菜单 + 免打扰时长子菜单、
// 详情内容（文件/媒体/链接）菜单 + 删除两档子菜单 B、好友行菜单。
// App 仍是唯一状态源：各菜单的开关态与动作都经 props 传入，本组件不持有业务状态；
// clientRef / t 经 useAppServices()/useT() 自取。纯搬移，DOM/行为逐字不变（Fragment 不引入包裹节点）。
import type { Dispatch, SetStateAction } from "react";
import { Forward, MessageCircle, Trash2, X } from "lucide-react";
import { useAppServices } from "../AppServicesContext";
import { useT } from "../i18n";
import type { ChatMessage, Conversation } from "../sdk/protocol";
import type { DownloadState } from "../download";
import type { MenuAction, MessageCtx } from "../menus";
import { AnchoredMenu } from "./AnchoredMenu";
import { MuteMenu } from "./MuteMenu";

type At<T> = { x: number; y: number } & T;
type Setter<T> = Dispatch<SetStateAction<T>>;

export interface ContextMenusHostProps {
  // 消息长按/右键菜单
  menu: At<{ m: ChatMessage }> | null;
  setMenu: Setter<At<{ m: ChatMessage }> | null>;
  messageActions: MenuAction<MessageCtx>[];
  uid: string;
  peer: string;
  groupConvId: string;
  chatIsSuper: boolean;
  canPinHere: boolean;
  transcripts: Record<number, unknown>;
  requestDelete: (m: ChatMessage, x: number, y: number) => void;
  // 会话行菜单 + 免打扰时长子菜单
  convMenu: At<{ c: Conversation }> | null;
  setConvMenu: Setter<At<{ c: Conversation }> | null>;
  conversationActions: MenuAction<{ c: Conversation }>[];
  requestMute: (c: Conversation, x: number, y: number) => void;
  convMuteMenu: At<{ c: Conversation }> | null;
  setConvMuted: (c: Conversation, muted: boolean, until?: number) => unknown;
  // 详情内容菜单 + 删除两档子菜单 B
  fileMenu: At<{ m: ChatMessage }> | null;
  setFileMenu: Setter<At<{ m: ChatMessage }> | null>;
  deleteMenu: At<{ m: ChatMessage }> | null;
  setDeleteMenu: Setter<At<{ m: ChatMessage }> | null>;
  dlStates: Record<string, DownloadState>;
  setForwardMode: Setter<"each" | "merged">;
  setForwarding: Setter<ChatMessage[] | null>;
  setGalleryOpen: Setter<boolean>;
  setViewer: Setter<{ m: ChatMessage; fromGallery?: boolean } | null>;
  locateInChat: (cid: string, seq: number) => void;
  onGateTap: (m: ChatMessage) => void;
  hideFileForMe: (m: ChatMessage) => Promise<void>;
  deleteFileForEveryone: (m: ChatMessage) => void;
  // 好友行 ⋯ 菜单
  friendMenu: At<{ userId: string }> | null;
  setFriendMenu: Setter<At<{ userId: string }> | null>;
  blockedSet: Set<string>;
  doFriendAction: (userId: string, fn: () => Promise<void>) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
}

export function ContextMenusHost(p: ContextMenusHostProps) {
  const { clientRef } = useAppServices();
  const t = useT();
  const {
    menu, setMenu, messageActions, uid, peer, groupConvId, chatIsSuper, canPinHere, transcripts, requestDelete,
    convMenu, setConvMenu, conversationActions, requestMute, convMuteMenu, setConvMuted,
    fileMenu, setFileMenu, deleteMenu, setDeleteMenu, dlStates, setForwardMode, setForwarding, setGalleryOpen, setViewer,
    locateInChat, onGateTap, hideFileForMe, deleteFileForEveryone,
    friendMenu, setFriendMenu, blockedSet, doFriendAction, unblock,
  } = p;

  return (
    <>
      {menu && (
        <AnchoredMenu x={menu.x} y={menu.y} className="ctx-menu">
          {messageActions
            .filter((a) => a.visible({ m: menu.m, uid, isGroup: !!groupConvId && !peer, isSuper: chatIsSuper, canPin: canPinHere, hasTranscript: transcripts[menu.m.convSeq] !== undefined }))
            .map((a) => (
              <button key={a.id} className={a.danger ? "danger" : undefined}
                onClick={() => {
                  // 删除走统一两档路由（弹子菜单 B / 直接仅删自己 / 本地删），对齐详情页；其余动作照常。
                  if (a.id === "delete") { const mm = menu.m, x = menu.x, y = menu.y; setMenu(null); requestDelete(mm, x, y); return; }
                  a.run({ m: menu.m, uid, isGroup: !!groupConvId && !peer, isSuper: chatIsSuper, canPin: canPinHere, hasTranscript: transcripts[menu.m.convSeq] !== undefined }); setMenu(null);
                }}>
                {a.icon && <a.icon size={16} className="menu-icon" />}{a.label}</button>
            ))}
        </AnchoredMenu>
      )}

      {convMenu && (
        <AnchoredMenu x={convMenu.x} y={convMenu.y} className="ctx-menu">
          {conversationActions
            .filter((a) => a.visible({ c: convMenu.c }))
            .map((a) => (
              <button key={a.id} className={a.danger ? "danger" : undefined}
                onClick={() => {
                  // 「免打扰」不直接执行：先弹时长子菜单（对齐 UX 稿 04 frame E）；需要锚点 x/y，
                  // 走统一两档路由，与消息菜单「删除」→ requestDelete 同一套写法。
                  if (a.id === "mute") { const cc = convMenu.c, x = convMenu.x, y = convMenu.y; setConvMenu(null); requestMute(cc, x, y); return; }
                  a.run({ c: convMenu.c }); setConvMenu(null);
                }}>
                {a.icon && <a.icon size={16} className="menu-icon" />}{a.label}</button>
            ))}
        </AnchoredMenu>
      )}

      {convMuteMenu && (
        <AnchoredMenu x={convMuteMenu.x} y={convMuteMenu.y} className="ctx-menu ctx-submenu-in">
          <MuteMenu onPick={(until) => setConvMuted(convMuteMenu.c, true, until)} />
        </AnchoredMenu>
      )}

      {fileMenu && (() => {
        // 详情内容右键菜单（**文件/媒体/链接三 tab 共用**，成员除外；对齐 iOS 详情各 tab 长按）：
        // 转发 / 定位到聊天 / 取消下载（仅下载中）/ 删除（任务2 两档）。菜单对任意 ChatMessage 通用。
        const m = fileMenu.m;
        const downloading = dlStates[m.content]?.phase === "downloading";
        return (
          <AnchoredMenu x={fileMenu.x} y={fileMenu.y} className="ctx-menu">
            <button onClick={() => {
              setFileMenu(null); setForwardMode("each");
              // 资料页文件 tab 视角只显文件名，看不到源消息的 caption/mentions；若原样透传会把当年
              // 原发件人挂在同一条文件上的「@xxx 附言」意外带到目标会话（对齐 iOS forwardFileMessage:
              // stripCaption:YES）。主流长按/查看器/多选/收藏等看得到附言的入口不受影响，仍保留 caption。
              setForwarding([{ ...m, caption: undefined, mentions: undefined, mentionAll: false }]);
            }}>
              <Forward size={16} className="menu-icon" />{t("common.forward")}</button>
            {/* 定位=回到聊天：只关会遮聊天的宿主（媒体库 / 查看器）；详情卡是右侧列不遮聊天，按用户要求保持不消失。 */}
            <button onClick={() => { setFileMenu(null); setGalleryOpen(false); setViewer(null); locateInChat(m.convId, m.convSeq); }}>
              <MessageCircle size={16} className="menu-icon" />{t("chat.menu.locate")}</button>
            {downloading && (
              <button onClick={() => { setFileMenu(null); onGateTap(m); }}>
                <X size={16} className="menu-icon" />{t("file.menu.cancel_download")}</button>
            )}
            {/* 删除统一走两档路由：可为所有人删则展开子菜单 B，否则直接仅删自己（不再在此平铺两项）。 */}
            <button className="danger" onClick={() => { const x = fileMenu.x, y = fileMenu.y; setFileMenu(null); requestDelete(m, x, y); }}>
              <Trash2 size={16} className="menu-icon" />{t("common.delete")}</button>
          </AnchoredMenu>
        );
      })()}

      {deleteMenu && (() => {
        // 删除两档子菜单 B（由菜单 A 的「删除」展开，对齐 iOS 原生子菜单）：为所有人删除 / 仅删除自己。
        // ctx-submenu-in：A→B 的自然过渡动画（从锚点淡入 + 轻微缩放/上移）。
        const m = deleteMenu.m;
        return (
          <AnchoredMenu x={deleteMenu.x} y={deleteMenu.y} className="ctx-menu ctx-submenu-in">
            {/* 破坏性重的「为所有人删除」放最后（destructive-last，与消息/会话菜单约定一致，降低误触不可逆项）。 */}
            <button className="danger" onClick={() => { setDeleteMenu(null); void hideFileForMe(m); }}>
              <Trash2 size={16} className="menu-icon" />{t("delete_sheet.only_me")}</button>
            <button className="danger" onClick={() => { setDeleteMenu(null); deleteFileForEveryone(m); }}>
              <Trash2 size={16} className="menu-icon" />{t("delete_sheet.everyone")}</button>
          </AnchoredMenu>
        );
      })()}

      {friendMenu && (
        <div className="ctx-menu" style={{ left: friendMenu.x, top: friendMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { const id = friendMenu.userId; setFriendMenu(null); void doFriendAction(id, () => clientRef.current!.removeFriend(id)); }}>{t("friend.menu.delete")}</button>
          {blockedSet.has(friendMenu.userId) ? (
            <button onClick={() => { const id = friendMenu.userId; setFriendMenu(null); void unblock(id); }}>{t("common.unblock")}</button>
          ) : (
            <button className="danger" onClick={() => { const id = friendMenu.userId; setFriendMenu(null); void doFriendAction(id, () => clientRef.current!.friendAction("block", id)); }}>{t("common.block")}</button>
          )}
        </div>
      )}
    </>
  );
}
