// im-rtc 通话宿主：登录后（本组件挂载）起引擎，退出登录（卸载）销毁；来电浮层与通话界面都由 uikit 画。
// 名字与头像走宿主的解析链（备注 > 昵称 > @句柄），通过 ProfileProvider 交给 uikit。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CallEngine } from "im-rtc-call-engine";
import { CallOverlay, CallProvider, ProfileProvider, useCall } from "im-rtc-call-uikit-react";
import type { InviteMemberProvider, ProfileResolver } from "im-rtc-call-uikit-react";
import { useLang } from "../i18n";
import { logger, LOG_TAG } from "../logging/logger";
import { startRtcEngine } from "./rtcEngine";
import { registerCallActions } from "./rtcCall";
import { buildInviteCandidates, type InviteMemberLike } from "./rtcProfiles";
import { useCallRecordSend, type CallRecordSendDeps } from "../useCallRecordSend";

/** 宿主身份链的三个口子，全部来自 App 现成的解析器。 */
export interface RtcProfiles {
  /** 本机显示名；解析不到返回 undefined（Kit 先画 uid，解析回来再重画）。 */
  nameOf: (uid: string) => string | undefined;
  avatarOf: (uid: string) => string | undefined;
  /** 声明「这些 uid 现在要显示」，缺的由 useUserProfiles 批量拉。 */
  request: (uids: string[]) => void;
  /**
   * 群成员一页（通话里「添加成员」的候选来源）：走宿主现成的服务端分页 + 搜索接口，普通群、超级群同一条路。
   * 拉不到要 reject（Kit 显示「加载失败」+ 重试），不要永不 resolve。
   */
  groupMembers?: (convId: string, opts: { q: string; cursor?: string }) => Promise<{ members: readonly InviteMemberLike[]; nextCursor: string }>;
}

/** 把 uikit 里拿到的 actions 注册到模块级出口。 */
function ActionsBridge(): null {
  const { actions } = useCall();
  useEffect(() => {
    registerCallActions(actions);
    return () => registerCallActions(null);
  }, [actions]);
  return null;
}

export function RtcHost({ uid, profiles, profileKey, record }: {
  uid: string;
  /** 通话记录发消息所需的 IM 出口：每通电话终局后 SDK 给一次 callSummary，由主叫发一条 content_type=call（见 useCallRecordSend）。 */
  record: Omit<CallRecordSendDeps, "uid">;
  profiles: RtcProfiles;
  /** 解析数据源（名片 / 好友 / 会话 / 群资料）：任一项换了引用就通知 Kit 重画。固定 4 项。 */
  profileKey: readonly unknown[];
}): ReactNode {
  const [engine, setEngine] = useState<CallEngine | null>(null);
  // 已解析的界面语言（不是"跟系统"，是用户在设置里选的那个），直接映射到 Kit 的 locale——
  // 与 iOS/Android 同一个选择：绕开 uikit 自带的 resolveLocale('auto', ...)，避免两套"跟系统"判据打架。
  const lang = useLang();

  useEffect(() => {
    if (!uid) return undefined;
    // StrictMode 会把 effect 跑两遍：用 cancelled 挡住第一遍还没登完就被清理的那次。
    let cancelled = false;
    let dispose: (() => void) | null = null;
    void startRtcEngine(uid, () => setEngine(null)).then((h) => {
      if (!h) return;
      if (cancelled) { h.dispose(); return; }
      dispose = h.dispose;
      setEngine(h.engine);
    });
    return () => {
      cancelled = true;
      dispose?.();
      setEngine(null);
    };
  }, [uid]);

  // 通话记录：订阅 SDK 的 callSummary。宿主不自己记通话上下文，事实由 SDK 一次给齐；发不发（role==caller）由 planCallRecord 判。
  const { sendCallRecord } = useCallRecordSend({ ...record, uid });
  const onSummaryRef = useRef(sendCallRecord);
  onSummaryRef.current = sendCallRecord;
  useEffect(() => {
    if (!engine) return undefined;
    return engine.on("callSummary", (s) => {
      logger.debug(LOG_TAG.rtc, "rtc_call_summary", { call_id: s.callId, role: s.role, reason: s.reason, duration_sec: s.durationSec, group: s.isGroup });
      onSummaryRef.current(s);
    });
  }, [engine]);

  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const listeners = useRef(new Set<(uids: readonly string[]) => void>());
  // Kit 问过的 uid：uikit 只对「自己这个 uid」的通知重画，所以广播时要带上真实 uid 而不是空数组。
  const asked = useRef(new Set<string>());
  const lastAnswer = useRef(new Map<string, string>());
  const resolver = useMemo<ProfileResolver>(() => ({
    resolve: (u) => {
      const p = profilesRef.current;
      asked.current.add(u);
      const name = p.nameOf(u);
      const avatarUrl = p.avatarOf(u);
      // 只在结果变了时记一条，方便对日志看「Kit 问了谁、宿主答了什么」。
      const seen = `${name ?? ""}|${avatarUrl ?? ""}`;
      if (lastAnswer.current.get(u) !== seen) {
        lastAnswer.current.set(u, seen);
        logger.debug(LOG_TAG.rtc, "rtc_profile_resolve", { uid: u, name: name ?? null, avatar: avatarUrl ?? null });
      }
      // 渲染路径里不同步改别的组件的状态：推迟到微任务再声明。
      if (!name) queueMicrotask(() => p.request([u]));
      return { name, avatarUrl };
    },
    subscribe: (cb) => { listeners.current.add(cb); return () => { listeners.current.delete(cb); }; },
  }), []);

  // 数据源变了：整体通知一次（一次通话最多 9 格，整屏重画比精细失效便宜）。
  useEffect(() => {
    const uids = [...asked.current];
    listeners.current.forEach((cb) => cb(uids));
  }, [profileKey[0], profileKey[1], profileKey[2], profileKey[3]]); // eslint-disable-line react-hooks/exhaustive-deps

  // 「添加成员」候选人：按 ctx.chatGroupId 取群成员。没有群号返回空页（不能悬着，Kit 10 秒判超时）。
  const inviteProvider = useMemo<InviteMemberProvider>(() => async (ctx, query, cursor) => {
    const p = profilesRef.current;
    if (!ctx.chatGroupId || !p.groupMembers) return { items: [] };
    const page = await p.groupMembers(ctx.chatGroupId, { q: query.trim(), cursor: cursor || undefined });
    // 搜索已在服务端做过，这里不再本地过滤（备注名命中不了服务端的 username / 昵称，本地再滤会误杀）。
    const items = buildInviteCandidates(page.members, uid, ctx.participantUids, "", p.nameOf, p.avatarOf);
    logger.debug(LOG_TAG.rtc, "rtc_invite_candidates", { group: ctx.chatGroupId, q: query, members: page.members.length, items: items.length, more: !!page.nextCursor });
    return page.nextCursor ? { items, nextCursor: page.nextCursor } : { items };
  }, [uid]);

  if (!engine) return null;
  return (
    <ProfileProvider resolver={resolver}>
      <CallProvider
        engine={engine}
        inviteMemberProvider={inviteProvider}
        bannerFirst
        ringtoneMuted={false}
        locale={lang === "zh-Hans" ? "zh-CN" : "en"}
      >
        <ActionsBridge />
        <CallOverlay />
      </CallProvider>
    </ProfileProvider>
  );
}
