// im-rtc 通话宿主：登录后（本组件挂载）起引擎，退出登录（卸载）销毁；来电浮层与通话界面都由 uikit 画。
// 名字与头像走宿主的解析链（备注 > 昵称 > @句柄），通过 ProfileProvider 交给 uikit。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CallEngine } from "im-rtc-call-engine";
import { CallOverlay, CallProvider, ProfileProvider, useCall } from "im-rtc-call-uikit-react";
import type { ProfileResolver } from "im-rtc-call-uikit-react";
import { logger, LOG_TAG } from "../logging/logger";
import { startRtcEngine } from "./rtcEngine";
import { registerCallActions } from "./rtcCall";

/** 宿主身份链的三个口子，全部来自 App 现成的解析器。 */
export interface RtcProfiles {
  /** 本机显示名；解析不到返回 undefined（Kit 先画 uid，解析回来再重画）。 */
  nameOf: (uid: string) => string | undefined;
  avatarOf: (uid: string) => string | undefined;
  /** 声明「这些 uid 现在要显示」，缺的由 useUserProfiles 批量拉。 */
  request: (uids: string[]) => void;
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

export function RtcHost({ uid, profiles, profileKey }: {
  uid: string;
  profiles: RtcProfiles;
  /** 解析数据源（名片 / 好友 / 会话 / 群资料）：任一项换了引用就通知 Kit 重画。固定 4 项。 */
  profileKey: readonly unknown[];
}): ReactNode {
  const [engine, setEngine] = useState<CallEngine | null>(null);

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

  if (!engine) return null;
  return (
    <ProfileProvider resolver={resolver}>
      <CallProvider engine={engine} bannerFirst ringtoneMuted={false}>
        <ActionsBridge />
        <CallOverlay />
      </CallProvider>
    </ProfileProvider>
  );
}
