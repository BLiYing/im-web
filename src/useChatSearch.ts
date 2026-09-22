// useChatSearch：会话内搜索 / 按日期日历 / 「来自」发件人过滤 / 首页全局搜索的状态 + 逻辑外壳
// （从 App.tsx 抽出控制体量，CODING_STYLE §7「①有自己状态+一组操作 → 自定义 Hook」）。纯本地，命中口径/
// 摘要/活跃日走已抽出的 searchPredicate（+单测）。副作用依赖（locateInChat/setToast/客户端/各 ref）
// 全部**注入**，Hook 不摸全局。行为与抽出前逐字一致（默认跳最新签名去重 / 越界提示上拉 / 切会话重置 …）。
//
// ⚠️ searchOpen / searchQuery 刻意**留在 App 受控注入**：App 里 highlightSearch 定义在本 Hook 调用点之前
//    （消息气泡渲染要读它），若把这两个 state 搬进来会令 highlightSearch 反向依赖后定义的 Hook（TDZ）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Conversation, GroupInfo } from "./sdk/protocol";
import { type MsgRecord } from "./sdk/localStore";
import { searchMessages } from "./sdk/localStore.search";
import { minSeqOf, isSearchableMessage } from "./messageContent";
import { messageMatchesNeedle, activeDayKeys } from "./searchPredicate";
import { isSameDay, monthDay } from "./time";
import { t, getLang } from "./i18n";
import { pickQuerySource, DEGRADED_SEARCH_NOTICE, DEGRADED_CALENDAR_NOTICE } from "./convQuerySource";
import { searchConvMessages, fetchConvCalendar, localUtcOffsetMs, type CalendarDay } from "./sdk/convQueriesApi";
import { prependOlderHits, MAX_EMPTY_PAGES, type SearchHit } from "./searchPaging";

import type { FromRow } from "./components/ChatSearchBar";

export interface ChatSearchDeps {
  // 受控的会话内搜索文本态（App 拥有，见文件头注释）
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  // 实时值
  /** **当前会话本地已有的全部消息**（升序）。会话内搜索/日历/发件人候选问的是"整个会话"，
   *  不是"现在渲染的那一窗"——W2 引入渲染窗口后这里一度传的是渲染切片，
   *  「会话内搜索」在 3 万条的群里只命中 98 条（=窗口条数）：界面照常、结果是错的。
   *  本 Hook 因此**刻意不接收渲染窗口**，从签名上杜绝再传错。 */
  allMessages: ChatMessage[];
  convId: string;
  groupConvId: string;
  uid: string;
  groupInfos: Record<string, GroupInfo>;
  conversations: Conversation[];
  // 回调 / 常量
  /** **唯一的跳转出口**：窗口内 → 滚动；本地有 → 移窗；都没有 → window_req 开窗。
   *  本 Hook 刻意不持有 jumpToSeq（只滚 DOM 的那个）——搜索命中/日历落点都可能在窗口外。 */
  locateInChat: (cid: string, seq: number, opts?: { earliest?: boolean }) => void;
  setToast: (msg: string | null) => void;
  /** 本会话的本地库是否**齐全**（区间清单覆盖到 head）。false = 有缺口，
   *  此时"整个会话"类问题不能再问本地（OFFLINE_BACKLOG_DESIGN §4.9）。 */
  localComplete: boolean;
  /** 当前是否在线：有缺口且离线时只能给本地结果 + 明确标注，不能假装完整。 */
  online: boolean;
  /** 取当前 token（服务端查询用）；未登录返回空串。 */
  getToken: () => string;
}

export function useChatSearch(d: ChatSearchDeps) {
  const {
    searchOpen, setSearchOpen, searchQuery, setSearchQuery,
    allMessages, convId, groupConvId, uid, groupInfos, conversations,
    locateInChat, setToast, localComplete, online, getToken,
  } = d;

  // 本会话的"整会话问题"该问谁（§4.9 三态）。三个功能（搜索命中 / 日历 / 跳某天）共用同一判断，
  // 各写一遍 if 迟早会分叉——而分叉的表现是"某个入口悄悄答错"，不是报错。
  const querySource = pickQuerySource(localComplete, online);
  // getToken 走 ref、**不进任何 effect 的依赖**：调用方给的是每次渲染新建的箭头函数（App 里就是
  // `getToken: () => clientRef.current?.authToken`），列进依赖 = effect 每次渲染都跑；而 effect 的早退分支
  // 又 `setServerHits([])`（新数组 ≠ 旧数组）再触发一次渲染——静默的渲染死循环，不报错、只是 CPU 打满、
  // App 级 jsdom 测试直接挂死（2026-09-03 实测）。取 token 只在发请求那一刻，用当时最新的即可。
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchSigRef = useRef("");                       // 上次「默认跳最新」的签名（会话|词|发件人）

  const [searchHitIdx, setSearchHitIdx] = useState(0);   // 当前命中下标（searchHits 升序，0=最早）
  const [searchFrom, setSearchFrom] = useState("");      // 「来自:」发件人 uid（""=不限，仅群聊）
  const [searchFromName, setSearchFromName] = useState(""); // token 显示名（👤 钮本身从不显名）
  const [searchFromPickerOpen, setSearchFromPickerOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<{ y: number; m: number }>(() => { const dt = new Date(); return { y: dt.getFullYear(), m: dt.getMonth() }; });
  const [homeSearch, setHomeSearch] = useState("");      // 首页全局搜索词
  const [homeMsgHits, setHomeMsgHits] = useState<MsgRecord[]>([]); // 聊天记录命中（防抖异步扫本地库）

  // ===== 会话内搜索：本地过滤已加载消息 → 命中集（升序，0=最早）；排除撤回/系统/未确认，叠加可选 `来自:`。=====
  const searchNeedle = searchQuery.trim().toLowerCase();
  const localHits = useMemo(() =>
    (searchOpen && (searchNeedle || searchFrom))
      ? allMessages.filter((m) => {
          if (!isSearchableMessage(m)) return false;
          if (searchFrom && m.from !== searchFrom) return false;
          return !searchNeedle || messageMatchesNeedle(m, searchNeedle);
        })
      : [],
    [searchOpen, searchNeedle, searchFrom, allMessages]);

  // 有缺口且在线 → 命中集改由服务端给（§4.9 第 1 项）。本地齐全时这段不发请求，
  // 行为与改造前**逐字一致**——绝大多数会话走的都是那条路。
  const [serverHits, setServerHits] = useState<SearchHit[]>([]);
  // 这份服务端命中属于哪一次查询（会话|词|发件人）。改词后新词结果要防抖 250ms 才回来，这段时间旧词的命中集
  // 还挂在 serverHits 上——不按它认，就会被当成新词的服务端结果：「默认跳最新」按旧集锁了签名、下标落在旧集末尾，
  // 新词结果回来签名没变、下标不再重置（2026-09-11 用户实测：搜「98」翻过一页后改「981」，计数「100 / 50+」、▲ 没反应）。
  const [serverKey, setServerKey] = useState("");
  const queryKey = `${convId}|${searchNeedle}|${searchFrom}`;
  // 服务端检索按页取（每页上限 50）。还有更早的页时计数写「/ 50+」，▲ 翻过最旧那条就去取下一页
  // （loadOlderHits）——而不是悄悄截断成 50 条还写「/ 50」，那会让人以为大群里就只有这些命中。
  const [hitsTruncated, setHitsTruncated] = useState(false);
  const [searchDegraded, setSearchDegraded] = useState(false);
  // 翻页用的三个 ref：下一页游标、是否有一次「取更早」在途、以及**查询代次**——
  // 词 / 发件人 / 会话一变代次就 +1，在途的旧页回来时对不上代次就丢，否则旧词的第二页会混进新词的命中集。
  const serverCursorRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const searchGenRef = useRef(0);
  const serverHitsRef = useRef(serverHits);
  serverHitsRef.current = serverHits;
  useEffect(() => {
    searchGenRef.current += 1;
    loadingOlderRef.current = false;
    serverCursorRef.current = 0;
    // 早退分支的清空必须**幂等**（已空就不换新数组），否则每次清空都是一次多余渲染。
    if (!searchOpen || (!searchNeedle && !searchFrom) || querySource === "local") {
      setServerHits((h) => (h.length ? [] : h)); setSearchDegraded(false); setHitsTruncated(false);
      return;
    }
    if (querySource === "local-degraded") {
      // 离线：给本地结果，但**必须说出来**只搜了已下载的部分——静默残缺才是真正的坑。
      setServerHits((h) => (h.length ? [] : h)); setSearchDegraded(true); setHitsTruncated(false);
      return;
    }
    setSearchDegraded(false);
    const token = getTokenRef.current();
    if (!token) return;
    const key = `${convId}|${searchNeedle}|${searchFrom}`;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchConvMessages(token, convId, searchQuery.trim(), { from: searchFrom || undefined, limit: 50 })
        .then((page) => {
          if (cancelled) return;
          // 服务端按 conv_seq 倒序返回；本 Hook 通篇按**升序**（0=最早）使用命中集，这里翻过来。
          setServerHits(page.items.map((i) => ({ convSeq: i.conv_seq, timestamp: i.timestamp })).reverse());
          setServerKey(key);
          serverCursorRef.current = page.next_cursor;
          setHitsTruncated(!!page.has_more && page.next_cursor > 0);
        })
        .catch(() => { if (!cancelled) { setServerHits([]); setHitsTruncated(false); } });
    }, 250); // 防抖：输入过程中不要每敲一个字打一次服务端
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchOpen, searchNeedle, searchFrom, searchQuery, convId, querySource]);

  // 命中集：服务端结果优先（有缺口时它才是完整的），否则本地。
  // 形状统一成 {convSeq, timestamp}——上层只用这两个字段做跳转与计数。
  const serverFresh = serverKey === queryKey;   // 旧查询的命中不认（见 serverKey 注释）
  const hitsFromServer = querySource === "server" && serverFresh && serverHits.length > 0;
  const searchHits = useMemo(
    () => (hitsFromServer ? serverHits : localHits),
    [hitsFromServer, serverHits, localHits],
  );
  // 词/发件人/会话变化 → 默认跳「最新一条命中」；签名去重避免每次渲染重跳。命中集为空时不锁签名（切会话消息异步载入中）。
  useEffect(() => {
    if (!searchOpen) { searchSigRef.current = ""; return; }
    // 签名要带**命中来自哪一份**：有缺口的会话里本地命中立刻算出来先锁签名，250ms 后服务端命中换掉命中集——
    // 不带来源的话签名没变、不重跳，下标还停在本地那份的最后一条，超出服务端命中集的长度
    // （2026-09-11 浏览器实测：计数「193 / 50+」、▲▼ 点了没反应）。翻更早的页时来源仍是 server，不会误跳。
    const sig = `${convId}|${searchNeedle}|${searchFrom}|${hitsFromServer ? "server" : "local"}`;
    if (sig === searchSigRef.current) return;
    if (searchHits.length === 0) { setSearchHitIdx(0); return; }
    searchSigRef.current = sig;
    const idx = searchHits.length - 1;
    setSearchHitIdx(idx);
    const seq = searchHits[idx].convSeq;
    // 走 locateInChat 而非 jumpToSeq：命中集来自**本地全量**，多半不在当前渲染窗口里，
    // 而 jumpToSeq 只会滚 DOM——跨不了窗，只会弹「原消息较早，请上拉加载后重试」。
    requestAnimationFrame(() => locateInChat(convId, seq));
  }, [searchOpen, convId, searchNeedle, searchFrom, searchHits, locateInChat]);
  // 还能不能往更早翻：只有走服务端、且服务端说还有下一页时。本地命中不分页，永远是 false。
  // 同样只认当前查询：新词结果回来前按 ▲，游标已按新词归零，拿它去翻旧词的命中集会把两个词的结果拼在一起。
  const canLoadOlderHits = querySource === "server" && serverFresh && hitsTruncated;

  /** 取服务端下一页（更早的命中），拼到命中集前面，并落到紧挨着原最旧命中的那一条。 */
  const loadOlderHits = async (): Promise<void> => {
    if (loadingOlderRef.current || !canLoadOlderHits) return;
    const token = getTokenRef.current();
    if (!token) return;
    loadingOlderRef.current = true;
    const gen = searchGenRef.current;
    const q = searchQuery.trim();
    try {
      // 服务端可能回空页却仍 has_more（逐人隐藏过滤掉了一整页），此时接着往前翻，但有上限。
      for (let attempt = 0; attempt <= MAX_EMPTY_PAGES; attempt++) {
        const page = await searchConvMessages(token, convId, q, { from: searchFrom || undefined, cursor: serverCursorRef.current, limit: 50 });
        if (gen !== searchGenRef.current) return;   // 词 / 发件人 / 会话在途中变了：这页属于上一次搜索
        serverCursorRef.current = page.next_cursor;
        const more = !!page.has_more && page.next_cursor > 0;
        const { hits, added } = prependOlderHits(serverHitsRef.current, page.items.map((i) => ({ convSeq: i.conv_seq, timestamp: i.timestamp })));
        if (added === 0 && more) continue;
        setHitsTruncated(more);
        if (added === 0) return;
        serverHitsRef.current = hits;
        setServerHits(hits);
        setSearchHitIdx(added - 1);
        locateInChat(convId, hits[added - 1].convSeq);
        return;
      }
    } catch {
      if (gen === searchGenRef.current) setToast(t("chat.search.load_older_failed"));
    } finally {
      if (gen === searchGenRef.current) loadingOlderRef.current = false;
    }
  };

  const gotoSearchHit = (idx: number) => {
    // 翻过已取回的最旧命中：服务端还有更早的页就去取（取回后自动落到紧挨着的那一条）。
    if (idx < 0 && canLoadOlderHits) { void loadOlderHits(); return; }
    if (idx < 0 || idx >= searchHits.length) return;
    setSearchHitIdx(idx);
    locateInChat(convId, searchHits[idx].convSeq); // ▲▼ 逐条跳同理：命中可能在窗口外
  };

  // 「来自:」候选 = 本会话已发言者去重（iOS 拍板：未发言者必 0 命中）；名字 我→「我」→消息昵称→成员昵称→uid。
  const searchFromRows = useMemo<FromRow[]>(() => {
    if (!searchFromPickerOpen || !groupConvId) return [];
    const members = groupInfos[groupConvId]?.members ?? [];
    const seen = new Set<string>();
    const rows: FromRow[] = [];
    for (const m of allMessages) {
      if (!m.from || m.recalledAt || m.contentType === "system" || seen.has(m.from)) continue;
      seen.add(m.from);
      const mem = members.find((x) => x.user_id === m.from);
      rows.push({ userId: m.from, label: m.from === uid ? t("common.me") : (m.fromNickname || mem?.nickname || m.from), role: mem?.role, avatarUrl: mem?.avatar_url });
    }
    return rows;
  }, [searchFromPickerOpen, groupConvId, groupInfos, uid, allMessages]);

  const closeInChatSearch = () => {
    setSearchOpen(false); setSearchQuery(""); setSearchFrom(""); setSearchFromName("");
    setSearchFromPickerOpen(false); setCalendarOpen(false);
  };
  const openInChatSearch = (initial = "") => {
    setSearchOpen(true); setSearchQuery(initial); setSearchFrom(""); setSearchFromName("");
    setSearchFromPickerOpen(false); setCalendarOpen(false);
    searchSigRef.current = "";
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };
  const openFromPicker = () => { setSearchFromPickerOpen(true); setCalendarOpen(false); };
  const pickSearchFrom = (memberUid: string, name: string) => {
    setSearchFrom(memberUid); setSearchFromName(name);
    setSearchFromPickerOpen(false);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };
  const clearSearchFrom = () => { setSearchFrom(""); setSearchFromName(""); };

  /** 「切到某会话后再开搜索」的待办（存 conv_id，""=无）。
   *
   *  为什么需要它：`openInChatSearch` 开的永远是**当前**会话的搜索，而从群成员资料卡点「搜索」
   *  时想搜的是与该成员的**单聊**——它还没被打开。直接调 openInChatSearch 会静默搜到当前那个群上
   *  （2026-08-31 修的 bug）；先切会话再调也不行——下面的 [convId] effect 会把刚开的搜索态关掉。
   *  故：切之前把目标 conv_id 记在这，切换落定后由那个 effect 接手打开。 */
  const pendingOpenConvRef = useRef("");

  /** 在**指定会话**里开搜索：已经是当前会话就立刻开，否则记下待办、由调用方去切会话。
   *  调用方（App）负责真正的切会话动作——本 Hook 不摸导航。 */
  const armInChatSearch = (targetConvId: string) => {
    if (!targetConvId || targetConvId === convId) { openInChatSearch(); return; }
    pendingOpenConvRef.current = targetConvId;
  };

  // 切会话 → 关残留搜索态（单页共享态，否则关键词+「来自:A成员」泄漏到 B；同会话开搜不改 convId 故不误关，/code-review #2）。
  // 若这次切换正是 armInChatSearch 要等的目标，关完立刻在新会话里开搜索（两次 setState 同批，无闪烁）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    closeInChatSearch();
    if (pendingOpenConvRef.current && pendingOpenConvRef.current === convId) {
      pendingOpenConvRef.current = "";
      openInChatSearch();
    }
  }, [convId]);

  // ===== 按日期跳转 / 日历：选日 → 跳「timestamp ≥ 当天 0 点」的首条（本机时区）=====
  const searchableMsgs = () => allMessages.filter(isSearchableMessage);
  // 月份数字/缩写口径同 time.ts 的私有 monthLabel（en 用短月名，zh 用数字串），不改 time.ts（本批不动该文件），故本地重复一份。
  const monthLabel = (dt: Date) => t("chat.search.calendar_month_label", {
    year: String(dt.getFullYear()),
    month: getLang() === "en" ? dt.toLocaleDateString("en-US", { month: "short" }) : String(dt.getMonth() + 1),
  });
  const localActiveDays = useMemo(() => activeDayKeys(allMessages), [allMessages]);

  // 日历打点（§4.9 第 3 项）：本地有缺口时，缺口对应的日子会静默变灰——日历"几乎全灰"这种错
  // 用户只会以为那几天真没聊天。有缺口且在线就按可见月份问服务端。
  const [serverDays, setServerDays] = useState<CalendarDay[]>([]);
  const [calendarDegraded, setCalendarDegraded] = useState(false);
  useEffect(() => {
    if (!calendarOpen || querySource === "local") { setServerDays((d) => (d.length ? [] : d)); setCalendarDegraded(false); return; }
    if (querySource === "local-degraded") { setServerDays((d) => (d.length ? [] : d)); setCalendarDegraded(true); return; }
    setCalendarDegraded(false);
    const token = getTokenRef.current();
    if (!token) return;
    // 只问当前显示的那个月（±1 个月的余量，覆盖翻月）——不给区间就是一次全会话扫描。
    const from = new Date(calendarMonth.y, calendarMonth.m - 1, 1).getTime();
    const to = new Date(calendarMonth.y, calendarMonth.m + 2, 1).getTime();
    let cancelled = false;
    void fetchConvCalendar(token, convId, from, to, localUtcOffsetMs())
      .then((res) => { if (!cancelled) setServerDays(res.days ?? []); })
      .catch(() => { if (!cancelled) setServerDays([]); });
    return () => { cancelled = true; };
  }, [calendarOpen, calendarMonth, convId, querySource]);

  // 服务端结果与本地打点合并：服务端权威，本地补上服务端区间之外（如刚发的今天）的日子。
  const activeDays = useMemo(() => {
    if (querySource !== "server" || serverDays.length === 0) return localActiveDays;
    const merged = new Set(localActiveDays);
    for (const d of serverDays) {
      const dt = new Date(d.day_start_ms);
      merged.add(`${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`);
    }
    return merged;
  }, [querySource, serverDays, localActiveDays]);

  /** 服务端已知的"某天第一条"，用于有缺口时跳到本地根本没有的那一天。 */
  const serverFirstSeqOfDay = (dayStart: number): number => {
    const hit = serverDays.find((d) => isSameDay(d.day_start_ms, dayStart));
    return hit ? hit.first_conv_seq : 0;
  };
  const jumpToDay = (dayStart: number, label: string) => {
    // 有缺口时优先用服务端给的"当天第一条"当锚点：那一天可能整段都不在本地，
    // 走下面的本地路径只会提示"早于已加载范围"——而它其实是能跳的（§4.9 第 4 项）。
    const serverSeq = querySource === "server" ? serverFirstSeqOfDay(dayStart) : 0;
    if (serverSeq > 0) {
      setCalendarOpen(false);
      locateInChat(convId, serverSeq); // locateInChat 内部会在本地没有时走 window_req 开窗
      return;
    }
    const list = searchableMsgs();
    const oldest = list[0]; // 升序，[0]=**本地已有**最旧（不是渲染窗口最旧）
    // 选中日早于本地最旧且本地没到会话开头（minSeq>1）→ 提示；否则会误跳本地最旧并谎称「已跳到最近的 X」（#1）。
    if (oldest && dayStart < oldest.timestamp && minSeqOf(allMessages) > 1) {
      setToast(t("chat.search.day_too_early", { label }));
      return;
    }
    const hit = list.find((m) => m.timestamp >= dayStart);
    if (!hit) { setToast(t("chat.search.day_no_messages", { label })); return; }
    setCalendarOpen(false);
    if (!isSameDay(hit.timestamp, dayStart)) {
      const dt = new Date(hit.timestamp);
      setToast(t("chat.search.day_jump_nearest", { label, date: monthDay(dt) }));
    }
    locateInChat(convId, hit.convSeq);
  };
  const jumpToToday = () => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const list = searchableMsgs();
    const hit = list.find((m) => m.timestamp >= now.getTime());
    if (hit) { setCalendarOpen(false); locateInChat(convId, hit.convSeq); return; }
    const last = list[list.length - 1]; // 今天无消息 → 跳最近一条（更早）
    if (!last) { setToast(t("chat.search.no_messages")); return; }
    setCalendarOpen(false);
    const dt = new Date(last.timestamp);
    setToast(t("chat.search.today_jump_nearest", { date: monthDay(dt) }));
    locateInChat(convId, last.convSeq);
  };
  // 「最早」：跳到会话首条。**一次锚点开窗直达**——
  // 旧实现是"自动上翻到顶（最多 40 页）再跳"，在长会话里既慢又可能翻不到头就放弃。
  // anchor=1 即会话第一条；服务端按可见下界过滤后回的就是"我能看到的最早那一段"。
  const jumpToEarliest = () => {
    setCalendarOpen(false);
    const first = allMessages.find((m) => m.convSeq > 0);
    if (!first) { setToast(t("chat.search.no_messages")); return; }
    // 本地已有第 1 条 → 仍走统一定位（它可能不在渲染窗口里，jumpToSeq 只会滚 DOM、跨不了窗）。
    if (minSeqOf(allMessages) <= 1) { locateInChat(convId, first.convSeq); return; }
    setToast(t("chat.search.loading_earlier"));
    // 借道统一定位入口：目标不在窗口 → 开窗 → 到达后滚动高亮，与其他定位场景同一条路径。
    // **带 earliest 标记**：anchor=1 只是"往最前面开一窗"的写法，1 号本身常常不是一条消息
    //（msg_op 事件行 / 墓碑 / 入群前对我不可见的行都占号）。不带标记的话，服务端明明把最早
    // 那一段都回来了，客户端却因为"锚点不是消息"报一句假的「原消息已被删除」然后放弃。
    locateInChat(convId, 1, { earliest: true });
  };

  // ===== 首页全局搜索：聊天记录走本地库 searchMessages（防抖 + 结果上限）=====
  useEffect(() => {
    const q = homeSearch.trim();
    if (!q) { setHomeMsgHits([]); return; }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void searchMessages(uid, { q, limit: 200 })
        .then((hits) => { if (!cancelled) setHomeMsgHits(hits); })
        .catch(() => { if (!cancelled) setHomeMsgHits([]); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [homeSearch, uid]);
  // 聊天记录命中不聚合；仅保留现存会话（本地库残留已退群/已删会话的消息无可打开落点）。homeMsgHits 已新→旧。
  const homeRecordHits = useMemo(() => {
    const known = new Set(conversations.map((c) => c.conv_id));
    return homeMsgHits.filter((r) => known.has(r.convId));
  }, [homeMsgHits, conversations]);

  return {
    searchNeedle, searchHits, searchHitIdx, hitsTruncated: serverFresh && hitsTruncated, gotoSearchHit, openInChatSearch, armInChatSearch, closeInChatSearch, searchInputRef,
    searchFrom, searchFromName, searchFromPickerOpen, setSearchFromPickerOpen, searchFromRows, openFromPicker, pickSearchFrom, clearSearchFrom,
    calendarOpen, setCalendarOpen, calendarMonth, setCalendarMonth, activeDays, jumpToDay, jumpToToday, jumpToEarliest, monthLabel,
    // 降级提示（§4.9）：离线 + 本地有缺口时，UI 必须把"只搜了已下载的部分"说出来。
    searchNotice: searchDegraded ? DEGRADED_SEARCH_NOTICE : "",
    calendarNotice: calendarDegraded ? DEGRADED_CALENDAR_NOTICE : "",
    homeSearch, setHomeSearch, homeRecordHits,
  };
}
