// useChatSearch：会话内搜索 / 按日期日历 / 「来自」发件人过滤 / 首页全局搜索的状态 + 逻辑外壳
// （从 App.tsx 抽出控制体量，CODING_STYLE §7「①有自己状态+一组操作 → 自定义 Hook」）。纯本地，命中口径/
// 摘要/活跃日走已抽出的 searchPredicate（+单测）。副作用依赖（jumpToSeq/locateInChat/setToast/客户端/各 ref）
// 全部**注入**，Hook 不摸全局。行为与抽出前逐字一致（默认跳最新签名去重 / 越界提示上拉 / 切会话重置 …）。
//
// ⚠️ searchOpen / searchQuery 刻意**留在 App 受控注入**：App 里 highlightSearch 定义在本 Hook 调用点之前
//    （消息气泡渲染要读它），若把这两个 state 搬进来会令 highlightSearch 反向依赖后定义的 Hook（TDZ）。
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { ChatMessage, Conversation, GroupInfo } from "./sdk/protocol";
import { searchMessages, type MsgRecord } from "./sdk/localStore";
import type { IMClient } from "./sdk/imSdk";
import { minSeqOf, isSearchableMessage } from "./messageContent";
import { messageMatchesNeedle, activeDayKeys } from "./searchPredicate";
import { isSameDay } from "./time";

import type { FromRow } from "./components/ChatSearchBar";

export interface ChatSearchDeps {
  // 受控的会话内搜索文本态（App 拥有，见文件头注释）
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  // 实时值
  messages: ChatMessage[];
  convId: string;
  groupConvId: string;
  uid: string;
  groupInfos: Record<string, GroupInfo>;
  conversations: Conversation[];
  msgsByConv: Record<string, ChatMessage[]>;
  // ref
  messagesRef: MutableRefObject<ChatMessage[]>;
  currentConvRef: MutableRefObject<string>;
  loadingOlderRef: MutableRefObject<boolean>;
  msgsRef: RefObject<HTMLDivElement>;
  histAnchorRef: MutableRefObject<{ h: number; t: number } | null>;
  clientRef: MutableRefObject<IMClient | null>;
  // 回调 / 常量
  jumpToSeq: (seq: number) => void;
  locateInChat: (cid: string, seq: number) => void;
  setToast: (msg: string | null) => void;
  maxLocatePages: number;
}

export function useChatSearch(d: ChatSearchDeps) {
  const {
    searchOpen, setSearchOpen, searchQuery, setSearchQuery,
    messages, convId, groupConvId, uid, groupInfos, conversations, msgsByConv,
    messagesRef, currentConvRef, loadingOlderRef, msgsRef, histAnchorRef, clientRef,
    jumpToSeq, locateInChat, setToast, maxLocatePages,
  } = d;

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchSigRef = useRef("");                       // 上次「默认跳最新」的签名（会话|词|发件人）
  const earliestPendingRef = useRef(false);
  const earliestTriesRef = useRef(0);

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
  const searchHits = useMemo(() =>
    (searchOpen && (searchNeedle || searchFrom))
      ? messages.filter((m) => {
          if (!isSearchableMessage(m)) return false;
          if (searchFrom && m.from !== searchFrom) return false;
          return !searchNeedle || messageMatchesNeedle(m, searchNeedle);
        })
      : [],
    [searchOpen, searchNeedle, searchFrom, messages]);
  // 词/发件人/会话变化 → 默认跳「最新一条命中」；签名去重避免每次渲染重跳。命中集为空时不锁签名（切会话消息异步载入中）。
  useEffect(() => {
    if (!searchOpen) { searchSigRef.current = ""; return; }
    const sig = `${convId}|${searchNeedle}|${searchFrom}`;
    if (sig === searchSigRef.current) return;
    if (searchHits.length === 0) { setSearchHitIdx(0); return; }
    searchSigRef.current = sig;
    const idx = searchHits.length - 1;
    setSearchHitIdx(idx);
    const seq = searchHits[idx].convSeq;
    requestAnimationFrame(() => jumpToSeq(seq));
  }, [searchOpen, convId, searchNeedle, searchFrom, searchHits, jumpToSeq]);
  const gotoSearchHit = (idx: number) => {
    if (idx < 0 || idx >= searchHits.length) return;
    setSearchHitIdx(idx);
    jumpToSeq(searchHits[idx].convSeq);
  };

  // 「来自:」候选 = 本会话已发言者去重（iOS 拍板：未发言者必 0 命中）；名字 我→「我」→消息昵称→成员昵称→uid。
  const searchFromRows = useMemo<FromRow[]>(() => {
    if (!searchFromPickerOpen || !groupConvId) return [];
    const members = groupInfos[groupConvId]?.members ?? [];
    const seen = new Set<string>();
    const rows: FromRow[] = [];
    for (const m of messages) {
      if (!m.from || m.recalledAt || m.contentType === "system" || seen.has(m.from)) continue;
      seen.add(m.from);
      const mem = members.find((x) => x.user_id === m.from);
      rows.push({ userId: m.from, label: m.from === uid ? "我" : (m.fromNickname || mem?.nickname || m.from), role: mem?.role, avatarUrl: mem?.avatar_url });
    }
    return rows;
  }, [searchFromPickerOpen, groupConvId, groupInfos, uid, messages]);

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
  // 切会话 → 关残留搜索态（单页共享态，否则关键词+「来自:A成员」泄漏到 B；同会话开搜不改 convId 故不误关，/code-review #2）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { closeInChatSearch(); }, [convId]);

  // ===== 按日期跳转 / 日历：选日 → 跳「timestamp ≥ 当天 0 点」的首条（本机时区）=====
  const searchableMsgs = () => messages.filter(isSearchableMessage);
  const monthLabel = (dt: Date) => `${dt.getFullYear()}年${dt.getMonth() + 1}月`;
  const activeDays = useMemo(() => activeDayKeys(messages), [messages]);
  const jumpToDay = (dayStart: number, label: string) => {
    const list = searchableMsgs();
    const oldest = list[0]; // 升序，[0]=已加载窗口最旧
    // 选中日早于已加载最旧且未到顶（minSeq>1）→ 提示上拉；否则会误跳已加载最旧并谎称「已跳到最近的 X」（原判据恒假、不可达，#1）。
    if (oldest && dayStart < oldest.timestamp && minSeqOf(messagesRef.current) > 1) {
      setToast(`${label}早于已加载范围，请上拉加载更早历史`);
      return;
    }
    const hit = list.find((m) => m.timestamp >= dayStart);
    if (!hit) { setToast(`${label}及之后无消息`); return; }
    setCalendarOpen(false);
    if (!isSameDay(hit.timestamp, dayStart)) {
      const dt = new Date(hit.timestamp);
      setToast(`${label}无消息，已跳到最近的 ${dt.getMonth() + 1}月${dt.getDate()}日`);
    }
    locateInChat(convId, hit.convSeq);
  };
  const jumpToToday = () => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const list = searchableMsgs();
    const hit = list.find((m) => m.timestamp >= t.getTime());
    if (hit) { setCalendarOpen(false); locateInChat(convId, hit.convSeq); return; }
    const last = list[list.length - 1]; // 今天无消息 → 跳最近一条（更早）
    if (!last) { setToast("暂无消息"); return; }
    setCalendarOpen(false);
    const dt = new Date(last.timestamp);
    setToast(`今天无消息，已跳到 ${dt.getMonth() + 1}月${dt.getDate()}日`);
    locateInChat(convId, last.convSeq);
  };
  // 「最早」：自动上翻到顶再跳会话首条（复用 loadOlder；页 200、上限 maxLocatePages）。
  const jumpToEarliest = () => {
    setCalendarOpen(false);
    const first = messagesRef.current.find((m) => m.convSeq > 0);
    if (!first) { setToast("暂无消息"); return; }
    if (minSeqOf(messagesRef.current) <= 1) { jumpToSeq(first.convSeq); return; } // 已到顶
    earliestPendingRef.current = true; earliestTriesRef.current = 0;
    setToast("正在加载更早历史…");
    driveEarliest();
  };
  const driveEarliest = useCallback(() => {
    if (!earliestPendingRef.current || currentConvRef.current !== convId) { earliestPendingRef.current = false; return; }
    const list = messagesRef.current;
    const first = list.find((m) => m.convSeq > 0);
    const oldest = minSeqOf(list);
    if (!first) { earliestPendingRef.current = false; return; }
    if (oldest <= 1 || earliestTriesRef.current >= maxLocatePages) { // 到顶 / 超上限 → 跳本地最早
      earliestPendingRef.current = false;
      requestAnimationFrame(() => jumpToSeq(first.convSeq));
      return;
    }
    if (loadingOlderRef.current) return; // 有一页在飞，等它到
    const box = msgsRef.current;
    if (box) histAnchorRef.current = { h: box.scrollHeight, t: box.scrollTop };
    earliestTriesRef.current += 1;
    loadingOlderRef.current = true;
    clientRef.current?.loadOlder(convId, oldest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, jumpToSeq]);
  useEffect(() => { driveEarliest(); }, [msgsByConv, driveEarliest]);

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
    searchNeedle, searchHits, searchHitIdx, gotoSearchHit, openInChatSearch, closeInChatSearch, searchInputRef,
    searchFrom, searchFromName, searchFromPickerOpen, setSearchFromPickerOpen, searchFromRows, openFromPicker, pickSearchFrom, clearSearchFrom,
    calendarOpen, setCalendarOpen, calendarMonth, setCalendarMonth, activeDays, jumpToDay, jumpToToday, jumpToEarliest, monthLabel,
    homeSearch, setHomeSearch, homeRecordHits,
  };
}
