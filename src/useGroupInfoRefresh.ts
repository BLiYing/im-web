// useGroupInfoRefresh：群资料缓存的拉取入口 + 群成员表过期检测。
//
// 从 App.tsx 抽出（2026-09-15，CODING_STYLE §7：App.tsx 已触体量基线，新增的过期检测不能再往里塞）。
// refreshGroupInfo 是**逐字平移**；App 在原位置调用本 Hook（登录早退之前，hook 数恒定），
// 返回的回调身份仍恒定（useCallback 空依赖），下游 useCallback/useEffect 的依赖不受影响。
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

export function useGroupInfoRefresh(
  clientRef: MutableRefObject<IMClient | null>,
  setGroupInfos: Dispatch<SetStateAction<Record<string, GroupInfo>>>,
  groupConvId: string,
  msgsByConv: MsgMap,
  groupInfos: Record<string, GroupInfo>,
): (cid: string) => Promise<GroupInfo | null> {
  // 拉群资料进缓存（best-effort）：失败（被移出/群没了）则清缓存。返回最新资料或 null。
  const refreshGroupInfo = useCallback(async (cid: string): Promise<GroupInfo | null> => {
    try {
      const info = await clientRef.current?.fetchGroup(cid);
      if (info) setGroupInfos((prev) => ({ ...prev, [cid]: info }));
      return info ?? null;
    } catch {
      setGroupInfos((prev) => {
        const { [cid]: _drop, ...rest } = prev;
        return rest;
      });
      return null;
    }
  }, []);

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
