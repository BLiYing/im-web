// uid → 公开名片的**全局解析缓存**（进程内，随页面刷新清空）。
//
// 为什么需要：端上此前把「群成员表」当身份字典用（拿 uid 回查 `groupInfos[cid].members`
// 取头像/昵称）。这个假设有两个洞——
//  · **超级群不下发成员表**（2 万人，只发群主+管理员），于是普通成员的气泡头像全是首字母圈；
//  · 普通群也有洞：**退群的人留下的历史消息**同样查不到（只是少见，一直没人报）。
//
// 用法：`request(ids)` 声明"这些 uid 现在要显示"，缺的会被攒起来批量拉；
// `cards[uid]` 读结果（undefined = 还没有，调用方照旧走各自的兜底）。
//
// 与 iOS 的 IMUserProfileCache 是同一套设计，改一边记得看另一边。
import { useCallback, useEffect, useRef, useState } from "react";
import type { UserCard } from "./sdk/protocol";
import { fetchUserProfilesBatch, USER_BATCH_MAX } from "./sdk/userProfileApi";

/** 合并窗口：一次渲染里几十个 uid 攒成一次请求，而不是几十次。 */
const COALESCE_MS = 50;
/** 负缓存有效期：查无此人先记 10 分钟，别每次重渲染都重试。 */
const MISSING_TTL_MS = 10 * 60 * 1000;
/**
 * 一批失败后的**退避窗口**。失败的 uid 不写负缓存（一次抖动不该变成十分钟的"查无此人"），
 * 但也不能立刻重来：调用方是渲染路径，App 每重渲染一次就会重新声明一遍这批 uid，
 * 断网时会以渲染频率反复打同一个接口——服务端 60 次/分的配额几秒就烧光，之后一直 429，
 * 网络恢复了也解析不出来（自己把自己锁死）。
 */
const FAILURE_BACKOFF_MS = 5000;

export interface UserProfilesState {
  /** 已解析到的名片。缺键 = 还没有（可能在飞、可能查无此人），调用方走自己的兜底。 */
  cards: Record<string, UserCard>;
  /** 声明这批 uid 现在要显示；已命中/已在飞/负缓存内的会被跳过。**引用稳定**，可直接进 deps。 */
  request: (ids: Array<string | undefined | null>) => void;
}

/**
 * @param token 鉴权 token。**从 IMClient.authToken 现取，别在外面存副本**——
 *              登录路径有三条，副本必然漂移（useMemberSearch 那次就静默 401 过）。
 *              token 变了（换号/重登）即整表清空：名片本身与账号无关，但留着旧号的
 *              解析结果会让"换号即清空"这条不变式变成有洞的。
 */
export function useUserProfiles(token: string): UserProfilesState {
  const [cards, setCards] = useState<Record<string, UserCard>>({});
  const pendingRef = useRef<Set<string>>(new Set());
  const inflightRef = useRef<Set<string>>(new Set());
  const missingRef = useRef<Map<string, number>>(new Map());
  const backoffUntilRef = useRef(0); // 上一批失败后的退避截止时刻（epoch ms）
  const knownRef = useRef<Set<string>>(new Set()); // cards 的键快照：request 是 useCallback，读不到最新 state
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // 换号/重登：整表清空（含在飞标记——不清的话新账号对同一批 uid 永远排不进队）。
  useEffect(() => {
    pendingRef.current.clear();
    inflightRef.current.clear();
    missingRef.current.clear();
    knownRef.current.clear();
    backoffUntilRef.current = 0;
    setCards({});
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, [token]);

  const flush = useCallback(async () => {
    timerRef.current = null;
    const tk = tokenRef.current;
    if (!tk) { pendingRef.current.clear(); return; } // 没登录：清空而不是留着，登录后该显示的会重新问
    // 退避中不发。**这一条也要有**：失败那批若有超过 USER_BATCH_MAX 的余量，finally 会顺手
    // schedule() 把余量发出去——那一发正好绕过刚设的退避。队列原样留着，
    // 退避过去后下一次 request() 会重新 schedule。
    if (Date.now() < backoffUntilRef.current) return;
    const batch = [...pendingRef.current].slice(0, USER_BATCH_MAX);
    if (batch.length === 0) return;
    batch.forEach((id) => { pendingRef.current.delete(id); inflightRef.current.add(id); });
    try {
      const res = await fetchUserProfilesBatch(tk, batch);
      const now = Date.now();
      res.missing.forEach((id) => missingRef.current.set(id, now));
      if (res.users.length > 0) {
        res.users.forEach((c) => knownRef.current.add(c.user_id));
        setCards((prev) => {
          const next = { ...prev };
          for (const c of res.users) next[c.user_id] = c;
          return next;
        });
      }
    } catch {
      // **失败不写负缓存**：那会把一次网络抖动变成 10 分钟的"查无此人"。
      // 但要退避一小会儿，否则下一次渲染立刻又来一遍（见 FAILURE_BACKOFF_MS）。
      backoffUntilRef.current = Date.now() + FAILURE_BACKOFF_MS;
    } finally {
      batch.forEach((id) => inflightRef.current.delete(id));
      if (pendingRef.current.size > 0) schedule(); // 超过一批的余量
    }
  }, []);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const schedule = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => { void flushRef.current(); }, COALESCE_MS);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const request = useCallback((ids: Array<string | undefined | null>) => {
    let added = false;
    const now = Date.now();
    if (now < backoffUntilRef.current) return; // 刚失败过，先歇一会（下一次渲染会再来问）
    for (const raw of ids) {
      const id = (raw ?? "").trim();
      if (!id) continue;
      if (knownRef.current.has(id) || inflightRef.current.has(id) || pendingRef.current.has(id)) continue;
      const missedAt = missingRef.current.get(id);
      if (missedAt !== undefined) {
        if (now - missedAt < MISSING_TTL_MS) continue;
        missingRef.current.delete(id); // 过期了，允许再试一次
      }
      pendingRef.current.add(id);
      added = true;
    }
    if (added) schedule();
  }, [schedule]);

  return { cards, request };
}
