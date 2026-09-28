// 「设置 ▸ 最近通话」数据簇：首页/游标翻页、callEnd 重拉首页并作废在途翻页请求（generation 计数器，
// 参考 im-rtc-web Demo `CallHistory.tsx`）、「全部/未接」筛选的自动续页。UI 无关，供 CallHistoryPanel 消费。
// 设计见 IMServer docs/design/CALL_HISTORY_DESIGN.md §1/§3/§3.5。
import { useCallback, useEffect, useRef, useState } from "react";
import type { CallHistoryRecord } from "im-rtc-call-engine";
import { ErrorCode, isRtcError } from "im-rtc-call-engine";
import { getCallEngine } from "./rtc/rtcCall";
import { needsAutoContinue, type CallHistoryTab } from "./callHistoryView";
import { logger, LOG_TAG } from "./logging/logger";

/** `fetchCallHistory` 的每页条数：SDK 默认值 20（`FetchCallHistoryOptions.limit` 文档，SDK 内部常量名
 *  `DEFAULT_CALL_HISTORY_LIMIT`）——该常量未进 SDK 包的公开导出面，这里按文档值镜像一份，不深链内部路径。 */
const PAGE_SIZE = 20;

/** ""=无错 · "auth"=票据失效（401，与既有"未登录"提示同文案，不单独造一套）· "network"=其余失败（含引擎未就绪）。 */
export type CallHistoryErrorKind = "" | "auth" | "network";

export interface UseCallHistoryResult {
  records: readonly CallHistoryRecord[];
  tab: CallHistoryTab;
  setTab: (t: CallHistoryTab) => void;
  /** 首页在途（列表为空时的整页 loading）或翻页在途（列表底部的小 loading）由调用方按 records.length 判。 */
  loading: boolean;
  error: CallHistoryErrorKind;
  hasMore: boolean;
  loadMore: () => void;
  /** 重试上一次失败的那次请求（首页失败重首页，翻页失败重同一游标）。 */
  retry: () => void;
}

export function useCallHistory(myUid: string): UseCallHistoryResult {
  const [records, setRecords] = useState<CallHistoryRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<CallHistoryErrorKind>("");
  const [tab, setTab] = useState<CallHistoryTab>("all");
  /** 刷新（callEnd/首次进页）会让还在路上的旧翻页请求作废：应答回来时代数对不上就丢掉。 */
  const generation = useRef(0);
  const cursorRef = useRef<number | null>(null);
  cursorRef.current = nextCursor;

  const load = useCallback((first: boolean) => {
    const engine = getCallEngine();
    if (!engine) { setError("network"); setLoading(false); return; }
    const ticket = first ? ++generation.current : generation.current;
    const cursor = first ? undefined : (cursorRef.current ?? undefined);
    setLoading(true);
    engine.fetchCallHistory({ limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) })
      .then((page) => {
        if (ticket !== generation.current) return; // 在途请求已作废
        setRecords((prev) => (first ? [...page.records] : [...prev, ...page.records]));
        setNextCursor(page.nextCursor);
        setError("");
      })
      .catch((err: unknown) => {
        if (ticket !== generation.current) return;
        logger.warn(LOG_TAG.rtc, "call_history_fetch_failed", { error: String(err), first });
        setError(isRtcError(err) && err.code === ErrorCode.tokenInvalid ? "auth" : "network");
      })
      .finally(() => {
        if (ticket === generation.current) setLoading(false);
      });
  }, []);

  // 首次进页拉首页；卸载时推进代数，让在途应答作废（不往已卸载的组件写状态）。
  useEffect(() => {
    load(true);
    return () => { generation.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid]);

  // 通话结束后仍留在本页：重拉首页，丢弃在途的旧翻页请求（generation 计数器）。
  // 仅在 hook 挂载时engine 已就绪的那一份引擎实例上订阅——与 RtcHost 生命周期一致（登录后才挂面板）。
  useEffect(() => {
    const engine = getCallEngine();
    if (!engine) return undefined;
    return engine.on("callEnd", () => load(true));
  }, [load]);

  // 「未接」tab：已加载的未接数不到一页量、且没到底 → 自动接着翻下一页，不用用户再点一次（§3.5）。
  useEffect(() => {
    if (loading) return;
    if (needsAutoContinue(tab, records, myUid, nextCursor, PAGE_SIZE)) load(false);
  }, [tab, records, myUid, nextCursor, loading, load]);

  const loadMore = useCallback(() => { if (!loading && nextCursor !== null) load(false); }, [loading, nextCursor, load]);
  const retry = useCallback(() => load(records.length === 0), [load, records.length]);

  return { records, tab, setTab, loading, error, hasMore: nextCursor !== null, loadMore, retry };
}
