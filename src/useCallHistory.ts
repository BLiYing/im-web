// 「设置 ▸ 最近通话」数据簇：首页/游标翻页、callEnd 重拉首页并作废在途翻页请求（generation 计数器，
// 参考 im-rtc-web Demo `CallHistory.tsx`）、「全部/未接」筛选的自动续页。UI 无关，供 CallHistoryPanel 消费。
// 设计见 IMServer docs/design/CALL_HISTORY_DESIGN.md §1/§3/§3.5。
import { useCallback, useEffect, useRef, useState } from "react";
import type { CallHistoryRecord } from "im-rtc-call-engine";
import { ErrorCode, isRtcError } from "im-rtc-call-engine";
import { ensureRtcReady, getCallEngine, onCallEngineChange } from "./rtc/rtcCall";
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
  // cursorRef 镜像 nextCursor：`load` 用 `useCallback(..., [])` 保持引用稳定（见下），
  // 靠这个 ref 而不是闭包捕获来读"最新游标"。`nextCursor` 目前只有一处 setter（下面 load 的
  // .then 里），如果以后再加一个 setNextCursor 调用点，务必也让它顺带更新 cursorRef，
  // 否则 loadMore 会读到过期游标（/code-review 2026-09-29 提醒：这里是手动同步，不是自动衍生）。
  const cursorRef = useRef<number | null>(null);
  cursorRef.current = nextCursor;
  /** 引擎实例更替时 +1，逼首次加载 / callEnd 订阅两个 effect 重新判断——engine 是模块级单例
   * （registerCallEngine/getCallEngine），不是 React state，effect 光靠自己的依赖数组感知不到它变了
   * （/code-review 2026-09-29 发现：面板在 RTC 引擎还没起来时就挂载，会永久卡在 error="network"，
   * 引擎后来就绪也没人告诉这两个 effect 该重新看一眼；重新登录换了个新引擎实例同理，callEnd 监听
   * 还订在旧引擎上，永远等不到新引擎的通话结束事件）。 */
  const [engineTick, setEngineTick] = useState(0);
  useEffect(() => onCallEngineChange(() => setEngineTick((t) => t + 1)), []);

  const load = useCallback((first: boolean) => {
    const engine = getCallEngine();
    if (!engine) { setError("network"); setLoading(false); return; }
    const ticket = first ? ++generation.current : generation.current;
    const cursor = first ? undefined : (cursorRef.current ?? undefined);
    setLoading(true);
    // 先让 Kit 确认已登录（启动时没登上的话它会先补一次）；补不上照常走 fetchCallHistory，由它报 2007 落到 network 态。
    ensureRtcReady()
      .then(() => engine.fetchCallHistory({ limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) }))
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

  // 首次进页拉首页；引擎晚到（engineTick 变化，含重新登录换新引擎实例）时重新拉一次首页，
  // 否则引擎没就绪时进页会永久卡在 error="network"。卸载时推进代数，让在途应答作废
  // （不往已卸载的组件写状态）。
  useEffect(() => {
    load(true);
    return () => { generation.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid, engineTick]);

  // 通话结束后仍留在本页：重拉首页，丢弃在途的旧翻页请求（generation 计数器）。engineTick 变化时
  // 重新订阅——否则引擎实例更替后旧订阅还挂在已经不用的旧引擎上，永远收不到新引擎的 callEnd。
  useEffect(() => {
    const engine = getCallEngine();
    if (!engine) return undefined;
    return engine.on("callEnd", () => load(true));
  }, [load, engineTick]);

  // 「未接」tab：已加载的未接数不到一页量、且没到底 → 自动接着翻下一页，不用用户再点一次（§3.5）。
  // error 非空时暂停：否则一次持续性失败（网络抖动/票据失效）会在每次失败后立刻重试，打成
  // 不设限的请求死循环，界面也永远定不到一个稳定的错误态给用户点重试（/code-review 2026-09-29
  // 发现）。用户点底部的重试按钮（CallHistoryPanel 的 retry()）成功后 error 清空，这个 effect
  // 才会继续判断要不要接着续页。
  useEffect(() => {
    if (loading || error !== "") return;
    if (needsAutoContinue(tab, records, myUid, nextCursor, PAGE_SIZE)) load(false);
  }, [tab, records, myUid, nextCursor, loading, error, load]);

  const loadMore = useCallback(() => { if (!loading && nextCursor !== null) load(false); }, [loading, nextCursor, load]);
  const retry = useCallback(() => load(records.length === 0), [load, records.length]);

  return { records, tab, setTab, loading, error, hasMore: nextCursor !== null, loadMore, retry };
}
