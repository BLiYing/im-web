// useFavorites：收藏簇（阶段 6，CODING_STYLE §7）——收藏弹窗状态（favorites 列表=null 关闭 / favPick 发送模式）+
// 收藏·打开·删除·复制·下载·转发·从收藏发送 + 菜单动作表 favoriteActions。函数体逐字平移。
// 依赖注入：clientRef/setToast/setMenu/setAttachPanel（useMediaSend）/saveMessageToDisk（useMediaDownload）/
// conversations/currentConvRef + 转发簇三件（setForwardMode/setForwarding/sendForwardToTarget，来自 useForward）。
// favSourceLabel（来源显示名，依赖 friends/friendLabel/memberNick 等 App 派生）留在 App。
import { useCallback, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { ChatMessage, Conversation, Favorite } from "./sdk/protocol";
import { buildFavoriteActions } from "./menus";
import { favoriteToMessage } from "./messageContent";

export interface FavoritesDeps {
  clientRef: MutableRefObject<IMClient | null>;
  setToast: (msg: string | null) => void;
  setMenu: (v: null) => void;
  setAttachPanel: (v: boolean) => void;
  saveMessageToDisk: (m: ChatMessage) => Promise<void>;
  conversations: Conversation[];
  currentConvRef: MutableRefObject<string>;
  setForwardMode: (m: "each" | "merged") => void;
  setForwarding: (m: ChatMessage[] | null) => void;
  sendForwardToTarget: (target: Conversation, msgsArg?: ChatMessage[]) => void;
  // 多选批量收藏（favoriteSelected）用：当前会话消息 + 已选 conv_seq 集 + 退出多选。
  msgsByConv: Record<string, ChatMessage[]>;
  selected: Set<number>;
  exitSelectMode: () => void;
}

export function useFavorites(d: FavoritesDeps) {
  const { clientRef, setToast, setMenu, setAttachPanel, saveMessageToDisk, conversations, currentConvRef, setForwardMode, setForwarding, sendForwardToTarget, msgsByConv, selected, exitSelectMode } = d;
  const [favorites, setFavorites] = useState<Favorite[] | null>(null); // 收藏列表弹窗（null=关闭，M4-4）
  const [favPick, setFavPick] = useState(false); // 收藏弹窗模式：true=从附件面板进的「从收藏发送」pick 模式

  // 收藏（M4-4）：内容快照到服务端（原消息撤回/删除后仍在），toast 反馈。
  const favoriteMessage = useCallback((m: ChatMessage) => {
    setMenu(null);
    void (async () => {
      try {
        await clientRef.current?.addFavorite({
          content_type: m.contentType, content: m.content, caption: m.caption, // 图说：连文字一起收藏（整体）
          file_name: m.fileName, file_size: m.fileSize, duration: m.duration, thumb: m.thumb, poster: m.posterUrl, // 文件名/大小/时长/磨砂缩略/视频封面首帧保真
          media_w: m.mediaW, media_h: m.mediaH, // 像素尺寸：收端按原比例定框，转发不丢宽高
          source_conv_id: m.convId, source_conv_seq: m.convSeq, source_from: m.from,
        });
        setToast("已收藏");
      } catch (e) { setToast(`收藏失败：${(e as Error).message}`); }
    })();
  }, []);
  // 多选批量收藏（与 iOS 拉齐）：当前会话所选消息逐条快照到收藏，末尾汇总吐司；系统行/撤回件跳过。
  const favoriteSelected = useCallback(() => {
    const list = (msgsByConv[currentConvRef.current] ?? []).filter((m) => m.convSeq > 0 && selected.has(m.convSeq) && !m.recalledAt && m.contentType !== "system" && m.content);
    if (list.length === 0) return;
    void (async () => {
      let ok = 0;
      for (const m of list) {
        try {
          await clientRef.current?.addFavorite({
            content_type: m.contentType, content: m.content, caption: m.caption,
            file_name: m.fileName, file_size: m.fileSize, duration: m.duration, waveform: m.waveform, thumb: m.thumb, poster: m.posterUrl,
            media_w: m.mediaW, media_h: m.mediaH,
            source_conv_id: m.convId, source_conv_seq: m.convSeq, source_from: m.from,
          });
          ok++;
        } catch { /* 单条失败跳过，末尾汇总 */ }
      }
      setToast(ok === 0 ? "收藏失败" : ok === list.length ? (ok === 1 ? "已收藏" : `已收藏 ${ok} 条`) : `已收藏 ${ok}/${list.length} 条`);
    })();
    exitSelectMode();
  }, [msgsByConv, selected, currentConvRef, exitSelectMode]);
  // 打开收藏列表弹窗（浏览态，账号卡入口）。
  const openFavorites = useCallback(() => {
    setFavPick(false);
    void (async () => {
      try { setFavorites(await clientRef.current?.listFavorites() ?? []); }
      catch (e) { setToast(`加载收藏失败：${(e as Error).message}`); }
    })();
  }, []);
  // 打开收藏弹窗（pick 态，聊天附件面板「从收藏发送」入口）。
  const openFavoritesPick = useCallback(() => {
    setAttachPanel(false); setFavPick(true);
    void (async () => {
      try { setFavorites(await clientRef.current?.listFavorites() ?? []); }
      catch (e) { setToast(`加载收藏失败：${(e as Error).message}`); }
    })();
  }, []);
  const closeFavorites = useCallback(() => { setFavorites(null); setFavPick(false); }, []);
  const removeFavorite = useCallback((id: number) => {
    void (async () => {
      try {
        await clientRef.current?.deleteFavorite(id);
        setFavorites((prev) => (prev ? prev.filter((f) => f.id !== id) : prev));
      } catch (e) { setToast(`删除失败：${(e as Error).message}`); }
    })();
  }, []);
  // ── 收藏动作（右键菜单 + 从收藏发送，复用转发/发送路径，§5.4/§6）──
  // 转发某条收藏到任意会话：合成 ChatMessage 后复用已有 ForwardPicker（forwarding 状态）。
  const forwardFavorite = useCallback((f: Favorite) => { setForwardMode("each"); setForwarding([favoriteToMessage(f)]); }, []);
  // 复制收藏（文本/链接）：写入剪贴板并吐司。
  const copyFavorite = useCallback((f: Favorite) => { void navigator.clipboard?.writeText(f.content); setToast("已复制"); }, []);
  // 下载收藏（媒体/文件）：合成 ChatMessage 复用 saveMessageToDisk（含失效探测）。
  const downloadFavorite = useCallback((f: Favorite) => { void saveMessageToDisk(favoriteToMessage(f)); }, [saveMessageToDisk]);
  const favoriteActions = useMemo(() => buildFavoriteActions({
    forward: forwardFavorite, copy: copyFavorite, download: downloadFavorite, delete: (f) => removeFavorite(f.id),
  }), [forwardFavorite, copyFavorite, downloadFavorite, removeFavorite]);
  // 从收藏发送（pick 模式）：所选收藏逐条发进当前会话（媒体/文件透传 URL，走 sendForwardToTarget），收起弹窗。
  const sendFavoritesToCurrent = useCallback((favs: Favorite[]) => {
    const conv = conversations.find((c) => c.conv_id === currentConvRef.current);
    if (!conv || favs.length === 0) return;
    sendForwardToTarget(conv, favs.map(favoriteToMessage));
    closeFavorites();
    setToast(favs.length === 1 ? "已发送" : `已发送 ${favs.length} 条`);
  }, [conversations, sendForwardToTarget, closeFavorites]);

  return {
    favorites, setFavorites, favPick,
    favoriteMessage, favoriteSelected, openFavorites, openFavoritesPick, closeFavorites, removeFavorite,
    forwardFavorite, copyFavorite, downloadFavorite, favoriteActions, sendFavoritesToCurrent,
  };
}
