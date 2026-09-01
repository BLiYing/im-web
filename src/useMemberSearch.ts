// 群成员搜索（详情抽屉 · 成员 Tab）。草图见 IMServer/docs/design/sketches/GROUP_MEMBER_SEARCH_UX_SKETCH.html。
//
// **恒走服务端 `?q=`，绝不本地过滤**——这是这个 hook 存在的全部理由：
// 超级群本地只有「已翻到的那几页」（2 万人群里通常就 50 个），拿它过滤 = 在 50 人里搜 2 万人，
// 界面看着正常、结果悄悄是错的（本仓栽过同一类，MESSAGE_WINDOW_DESIGN §5.1 两端共 12 处）。
// 普通群 `gp.members` 虽然是全的，也**不走第二套口径**：两套迟早分叉，而分叉那天没人会发现。
import { useCallback, useEffect, useRef, useState } from "react";
import type { GroupMember } from "./sdk/protocol";
import { fetchGroupMembersPage } from "./sdk/serverConfigApi";
import { normalizeQuery } from "./listSearch";

/** 输入到发请求之间的静默期。与 @人选择器同口径，别各调各的。 */
export const MEMBER_SEARCH_DEBOUNCE_MS = 300;
/** 每页条数；结果本身也可能很长（搜 "big" 能命中几千人），所以结果也要翻页。 */
export const MEMBER_SEARCH_PAGE = 50;

export interface MemberSearchState {
  query: string;
  setQuery: (v: string) => void;
  /** 已归一化的搜索词；非空 = 处于搜索态（列表该显示结果而非浏览态）。 */
  needle: string;
  results: GroupMember[];
  loading: boolean;
  hasMore: boolean;
  /** 请求失败（保留上一次结果，见下方注释）。 */
  failed: boolean;
  loadMore: () => void;
  clear: () => void;
}

/**
 * @param convId  当前群会话 id；变了就整体复位（换群还留着上个群的搜索结果是灾难）。
 * @param token   鉴权 token。**从 IMClient.authToken 现取，别在外面存副本**——
 *                登录路径有三条，副本必然漂移（2026-08-31 就因此静默 401、界面只显示"候选是空的"）。
 */
export function useMemberSearch(convId: string | undefined, token: string): MemberSearchState {
  const [query, setQuery] = useState("");
  const [needle, setNeedle] = useState("");
  const [results, setResults] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cursor, setCursor] = useState<{ next: string; hasMore: boolean }>({ next: "", hasMore: false });

  // 请求序号：**丢弃过期响应**。快速打字时后发先至会让结果闪回旧关键词的答案——
  // iOS @人选择器早就有这套，Web 这边补上。ref 不用 state：它要在异步回调里读到最新值。
  const seqRef = useRef(0);
  // 「加载更多结果」的在途守卫。同 superLoadingRef：state 要等下一次渲染才可见，
  // 而连点的间隔比那还短，用 state 挡不住。
  const moreRef = useRef(false);

  const reset = useCallback(() => {
    seqRef.current++; // 让所有在途响应作废
    moreRef.current = false;
    setQuery("");
    setNeedle("");
    setResults([]);
    setLoading(false);
    setFailed(false);
    setCursor({ next: "", hasMore: false });
  }, []);

  // 换群整体复位。
  useEffect(() => { reset(); }, [convId, reset]);

  // 输入 → 去抖 → 首页请求。
  useEffect(() => {
    const q = normalizeQuery(query);
    if (!q) {
      // 清空回浏览态：作废在途响应，否则上一次搜索的结果会在清空后姗姗来迟、盖回列表。
      seqRef.current++;
      setNeedle("");
      setResults([]);
      setLoading(false);
      setFailed(false);
      setCursor({ next: "", hasMore: false });
      return;
    }
    if (!convId || !token) return;
    const seq = ++seqRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const page = await fetchGroupMembersPage(token, convId, { q, limit: MEMBER_SEARCH_PAGE });
          if (seq !== seqRef.current) return; // 过期响应，丢弃
          setNeedle(q);
          setResults(page.members);
          setCursor({ next: page.next_cursor ?? "", hasMore: !!page.has_more });
          setFailed(false);
        } catch {
          if (seq !== seqRef.current) return;
          // **保留上一次结果**，不要清空成"没有匹配"——清空会让用户以为查无此人，
          // 而不是网断了。needle 也保持，界面仍是搜索态。
          setFailed(true);
        } finally {
          if (seq === seqRef.current) setLoading(false);
        }
      })();
    }, MEMBER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, convId, token]);

  const loadMore = useCallback(() => {
    if (!convId || !token || !needle || !cursor.hasMore || moreRef.current) return;
    moreRef.current = true;
    const seq = seqRef.current; // 续页不自增：它属于当前这次搜索，不该让首页请求作废
    setLoading(true);
    void (async () => {
      try {
        const page = await fetchGroupMembersPage(token, convId, {
          q: needle, cursor: cursor.next, limit: MEMBER_SEARCH_PAGE,
        });
        if (seq !== seqRef.current) return; // 期间用户又打了字，这页已经不属于当前搜索词
        // 按 user_id 去重再追加：keyset 游标翻页期间有人进群/退群，相邻两页可能覆盖同一个人。
        setResults((prev) => {
          const seen = new Set(prev.map((m) => m.user_id));
          return [...prev, ...page.members.filter((m) => !seen.has(m.user_id))];
        });
        setCursor({ next: page.next_cursor ?? "", hasMore: !!page.has_more });
        setFailed(false);
      } catch {
        if (seq !== seqRef.current) return;
        setFailed(true);
        setCursor((prev) => ({ ...prev, hasMore: false })); // 别让「加载更多结果」变成点不完的死循环
      } finally {
        if (seq === seqRef.current) setLoading(false);
        moreRef.current = false;
      }
    })();
  }, [convId, token, needle, cursor]);

  return { query, setQuery, needle, results, loading, hasMore: cursor.hasMore, failed, loadMore, clear: reset };
}
