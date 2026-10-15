import { useCallback } from "react";
import { LOG_TAG, logger } from "./logging/logger";
import { t } from "./i18n";

/**
 * 多选批量删除的执行（从 App.tsx 拆出，CODING_STYLE §7）。
 *
 * - `schedulePinnedRefresh(cid)`：置顶集合按会话 300ms 合并重拉（usePinnedMessages.ts 的 schedule，onMessageRemoved 与批量删除结束共用）。
 * - `runBatchDelete`：两档都是一次批量请求（PROTOCOL §6.7.1 / §6.7.2），服务端逐条回成败；成功的由 SDK 本地移除，
 *   失败的留在屏上，条数汇总成一句「N 条删除失败」（不逐条 toast）。整单失败（断网/已不在会话）按全部失败算。
 *   结束后**无条件**重拉一次置顶横幅：删掉的可能正是置顶项，而置顶列表此刻未必已加载完。
 */
export function useBatchDelete(schedulePinnedRefresh: (cid: string) => void, setToast: (msg: string) => void) {
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
  return { runBatchDelete };
}
