// useGroupInfoRefresh：群资料缓存的拉取入口 + 群成员表过期检测。
//
// 从 App.tsx 抽出（2026-09-15，CODING_STYLE §7：App.tsx 已触体量基线，新增的过期检测不能再往里塞）。
// App 在原位置调用本 Hook（登录早退之前，hook 数恒定）；refreshGroupInfo = 单次拉取 fetchOnce + 按会话单飞包装，
// 返回的回调身份仍恒定（fetchOnce 空依赖），下游 useCallback/useEffect 的依赖不受影响。
//
// 过期检测（chatNaming senderLabel「成员表优先」的配套）：成员表是进会话时拉的，会话开着期间有人改了名
// 再发消息，旧成员表会把这条新消息也压回旧名。新到的末条带的昵称与成员表对不上 → 重拉（5s 节流）。
// 只看「末条换了」那一刻：进会话时的末条是本地老快照，拿它比只会白拉一次（openGroupChat 已经拉过）。
// 对端 iOS IMChatViewController+Group.m 的 refreshGroupInfoIfSenderRenamed:、Android ui/MemberNameRefresh.kt。
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { IMClient } from "./sdk/imSdk";
import type { GroupInfo } from "./sdk/protocol";
import type { MsgMap } from "./messageStore";
import { memberNicknameStale, memberTableNickname } from "./chatNaming";

/** 同一会话两次补拉之间的最小间隔：让一阵连发的群帧合并成少量 GET。 */
const REFRESH_GAP_MS = 200;

export function useGroupInfoRefresh(
  clientRef: MutableRefObject<IMClient | null>,
  setGroupInfos: Dispatch<SetStateAction<Record<string, GroupInfo>>>,
  groupConvId: string,
  msgsByConv: MsgMap,
  groupInfos: Record<string, GroupInfo>,
  onSuperCountChanged?: (cid: string) => void,
): (cid: string) => Promise<GroupInfo | null> {
  // 拉群资料进缓存（best-effort）：失败（被移出/群没了）则清缓存。返回最新资料或 null。
  // 超级群的成员列表是另一份分页 state（App.superMembers，只在切群时重拉）：人数变了（移除 / 退群 / 入群）
  // 必须通知 App 重拉第一页，否则资料页副标题已变、列表里被移除的人还在。
  const superCountRef = useRef<Record<string, number>>({});
  const onCountRef = useRef(onSuperCountChanged);
  onCountRef.current = onSuperCountChanged;
  const fetchOnce = useCallback(async (cid: string): Promise<GroupInfo | null> => {
    const client = clientRef.current;
    try {
      const info = await client?.fetchGroup(cid);
      if (clientRef.current !== client) return null; // 拉取期间换了账号/重建了客户端：旧账号的结果不能写进新账号的缓存
      if (info) {
        setGroupInfos((prev) => ({ ...prev, [cid]: info }));
        if (info.is_super) {
          const before = superCountRef.current[cid];
          superCountRef.current[cid] = info.member_count ?? 0;
          if (before !== undefined && before !== (info.member_count ?? 0)) onCountRef.current?.(cid);
        }
      }
      return info ?? null;
    } catch {
      if (clientRef.current !== client) return null;
      setGroupInfos((prev) => {
        const { [cid]: _drop, ...rest } = prev;
        return rest;
      });
      return null;
    }
  }, []);

  // 按会话**单飞 + 置脏补拉 + 限速**：群帧连发（一次邀请 100 人曾推 100 帧）时不能一帧一个 GET。
  //  - 首轮立即发（单个事件零额外延迟）；每轮结束后该会话冷却 REFRESH_GAP_MS，冷却内/在飞期间的调用只置脏，
  //    冷却结束补**一**轮（在飞那次可能早于刚发生的写）→ 帧持续到达时也只是每 REFRESH_GAP_MS + RTT 一次 GET。
  //  - 后到的调用拿的是**下一轮**的结果（它要的是调用之后的最新态，不是在飞那份）。
  //  - 补拉不看上一轮成败：在飞那次失败（如邀请帧先于入群落库 → 403）时，后来的调用正是为了纠正它。
  //  - 记录带上发起时的 client：换账号后不复用旧账号的记录（fetchOnce 对结果也有同一道闸）。
  type Deferred = { promise: Promise<GroupInfo | null>; resolve: (v: GroupInfo | null) => void };
  const defer = (): Deferred => {
    let resolve!: (v: GroupInfo | null) => void;
    const promise = new Promise<GroupInfo | null>((r) => { resolve = r; });
    return { promise, resolve };
  };
  type Flight = { dirty: boolean; client: IMClient | null; cur: Deferred; next: Deferred | null };
  const inflightRef = useRef<Map<string, Flight>>(new Map());
  const runFlight = useCallback(async (cid: string, entry: Flight) => {
    try {
      for (;;) {
        entry.dirty = false;
        entry.cur.resolve(await fetchOnce(cid)); // fetchOnce 内部兜住了异常，恒 resolve
        await new Promise((r) => setTimeout(r, REFRESH_GAP_MS));
        if (!entry.dirty || !entry.next) break; // 只有新调用才会再置脏，故失败也不会死循环
        entry.cur = entry.next;
        entry.next = null;
      }
    } finally {
      if (inflightRef.current.get(cid) === entry) inflightRef.current.delete(cid);
    }
  }, [fetchOnce]);
  const refreshGroupInfo = useCallback((cid: string): Promise<GroupInfo | null> => {
    const cur = inflightRef.current.get(cid);
    if (cur && cur.client === clientRef.current) {
      cur.dirty = true;
      cur.next ??= defer();
      return cur.next.promise;
    }
    const entry: Flight = { dirty: false, client: clientRef.current, cur: defer(), next: null };
    inflightRef.current.set(cid, entry);
    void runFlight(cid, entry);
    return entry.cur.promise;
  }, [runFlight]);

  const memberNickTailRef = useRef<{ cid: string; key: string }>({ cid: "", key: "" });
  const memberNickRefreshAtRef = useRef(0);
  useEffect(() => {
    if (!groupConvId) return;
    const list = msgsByConv[groupConvId] ?? [];
    const last = list[list.length - 1];
    const key = last ? `${last.convSeq}:${last.clientMsgId ?? ""}` : "";
    const prev = memberNickTailRef.current;
    memberNickTailRef.current = { cid: groupConvId, key };
    if (prev.cid !== groupConvId || prev.key === key || !last) return; // 刚切进来记基线 / 末条没变
    if (!memberNicknameStale(memberTableNickname(groupInfos[groupConvId], last.from), last.fromNickname)) return;
    const now = Date.now();
    if (now - memberNickRefreshAtRef.current < 5000) return;
    memberNickRefreshAtRef.current = now;
    void refreshGroupInfo(groupConvId);
  }, [groupConvId, msgsByConv, groupInfos, refreshGroupInfo]);

  return refreshGroupInfo;
}
