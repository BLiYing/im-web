import { useCallback, useMemo } from "react";
import { keyedDebounce } from "./selectDelete";
import { LOG_TAG, logger } from "./logging/logger";
import { t } from "./i18n";

/** 置顶横幅重拉的合并窗口：批量删除带来的一串「消息被移除」落在这个窗口里只拉一次。 */
const PINNED_REFRESH_COALESCE_MS = 300;

/**
 * 多选批量删除的执行 + 置顶横幅的合并重拉（从 App.tsx 拆出，CODING_STYLE §7）。
 *
 * - `schedulePinnedRefresh(cid)`：同一会话 300ms 内多次触发只拉一次（onMessageRemoved 与批量删除结束共用）。
 * - `runBatchDelete`：两档都是一次批量请求（PROTOCOL §6.7.1 / §6.7.2），服务端逐条回成败；成功的由 SDK 本地移除，
 *   失败的留在屏上，条数汇总成一句「N 条删除失败」（不逐条 toast）。整单失败（断网/已不在会话）按全部失败算。
 *   结束后**无条件**重拉一次置顶横幅：删掉的可能正是置顶项，而置顶列表此刻未必已加载完。
 */
export function useBatchDelete(refreshPinned: (cid: string) => Promise<void>, setToast: (msg: string) => void) {
  const schedulePinnedRefresh = useMemo(() => keyedDebounce(PINNED_REFRESH_COALESCE_MS, (cid) => void refreshPinned(cid)), [refreshPinned]);
  const runBatchDelete = useCallback((cid: string, seqs: number[], call: (seqs: number[]) => Promise<number>) => {
    void call(seqs)
      .catch((e: unknown) => {
        logger.warn(LOG_TAG.ui, "batch_delete_failed", { conv_id: cid, count: seqs.length, message: (e as Error).message });
        return seqs.length;
      })
      .then((failed) => {
        if (failed > 0) setToast(t("chat.select.delete_failed_count", { count: failed }));
        schedulePinnedRefresh(cid);
      });
  }, [schedulePinnedRefresh, setToast]);
  return { schedulePinnedRefresh, runBatchDelete };
}
