import { useEffect } from "react";
import type { ChatMessage } from "./sdk/protocol";
import { isViewableMedia, msgKey } from "./album";
import type { MediaServerPaging } from "./useMediaServerPaging";

//  任务3 · 查看器媒体时间线：当前会话全部图/视频按时序混排，供查看器左右翻页（Telegram 式）。
//  口径与媒体库一致（image|video && 未撤回 && content 非空）；仅覆盖**内存中已加载**的消息——翻到头即停，
//  不自动拉更早（第一版约定）。合成消息（收藏/记录预览：convSeq=0 且不在会话流内）mediaId 找不到 → 不显箭头、不翻页。
//
//  稳定标识 mediaId：**必须用 convSeq**（会话内唯一，收到/同步的消息都有）。绝不能用 clientMsgId——
//  入站消息（别人发的 + 自己刷新后重新同步的）在 imSdk.processIncoming 里根本不写 clientMsgId（全为 undefined），
//  一旦拿它 findIndex，会一律命中"第一条 undefined"的媒体，导致点最后一张却定位到最前、翻页错乱/卡死。
//  仅本地待发件（convSeq=0）无 convSeq，回退用其本地生成的 clientMsgId。见 album.ts msgKey。
// （2026-10-02 从 App.tsx 抽出，只为控体量；逻辑一字未改，另加「翻过最旧一张去服务端续拉」。）
export function useViewerNav(o: {
  viewer: { m: ChatMessage; fromGallery?: boolean } | null;
  setViewer: React.Dispatch<React.SetStateAction<{ m: ChatMessage; fromGallery?: boolean } | null>>;
  messages: ChatMessage[];
  mediaPaging: MediaServerPaging;
  setViewerMore: (v: boolean) => void;
  setToast: (s: string) => void;
  t: (key: string) => string;
}) {
  const { viewer, setViewer, messages, mediaPaging, setViewerMore, setToast, t } = o;
  const viewerList = viewer
    ? mediaPaging.merge(messages.filter((mm) => isViewableMedia(mm) && !!mm.content))
    : [];
  const viewerIdx = viewer ? viewerList.findIndex((mm) => msgKey(mm) === msgKey(viewer.m)) : -1;
  const goViewer = (delta: number) => {
    if (viewerIdx < 0) return;
    const ni = viewerIdx + delta;
    if (ni < 0 && viewerIdx === 0 && mediaPaging.hasMore) {
      // 翻过本地已有的最旧一张：服务端还有更旧的就去要一页，落到紧挨着的那一张；失败 = 离线降级，说一句别装「到头了」
      const fromKey = msgKey(viewer!.m);
      void mediaPaging.loadOlder().then((added) => {
        if (added === null) { setToast(t("media.viewer.offline_partial_notice")); return; }
        const target = added[added.length - 1];
        setViewerMore(false);
        // 等待期间用户可能已翻走 / 关了：只在仍停在发起时那一张才落到新增的那批里（否则会把人拽回去）
        if (target) setViewer((v) => (v && msgKey(v.m) === fromKey ? { m: target, fromGallery: v.fromGallery } : v));
      });
      return;
    }
    if (ni >= viewerList.length && viewerIdx === viewerList.length - 1 && mediaPaging.hasMoreNewer) {
      // 翻过本地段上沿最新的一张：服务端还有更新的就去要一页，落到紧挨着的那一张；失败 = 离线降级，说一句
      const fromKey = msgKey(viewer!.m);
      void mediaPaging.loadNewer().then((added) => {
        if (added === null) { setToast(t("media.viewer.offline_partial_notice")); return; }
        const target = added[0];
        setViewerMore(false);
        if (target) setViewer((v) => (v && msgKey(v.m) === fromKey ? { m: target, fromGallery: v.fromGallery } : v));
      });
      return;
    }
    if (ni < 0 || ni >= viewerList.length) return;
    setViewerMore(false); // 翻页收起「更多」浮层，避免停留在上一张的菜单上
    setViewer((v) => (v ? { m: viewerList[ni], fromGallery: v.fromGallery } : v));
  };
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      // 视频获焦时把 ←/→ 让给原生播放器做 ±5s 跳转，不劫持为翻页（点箭头仍可翻页）。
      if (document.activeElement instanceof HTMLVideoElement) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goViewer(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goViewer(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, viewerIdx, viewerList.length, mediaPaging.hasMore, mediaPaging.hasMoreNewer]);
  return { viewerList, viewerIdx, goViewer };
}
