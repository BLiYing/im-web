// 定时免打扰到期刷新（NOTIFICATIONS_P1_DESIGN.md §4.4）：算出本机会话里「最近的一个未来 mute_until」，
// 挂一个定时器，到点后强制重渲染一次——App 一重渲染，列表铃铛/未读变灰/badgeCountOf/favicon/例外列表
// 这些**全部现读 `Date.now()`、非 memo 缓存**的地方就自动跟着翻新（见各自实现头注）。
// **不发任何网络请求**：服务端同一时刻自然也按「已过期」返回，客户端自己判就够（同 online_until 先例）。
// App 回到前台时也刷新一次——后台期间 setTimeout 可能被节流/暂停，focus/visibilitychange 兜底补一次。
import { useEffect, useState } from "react";
import type { Conversation } from "./sdk/protocol";

export function useMuteExpiryTick(conversations: readonly Conversation[]): void {
  const [, setTick] = useState(0);

  useEffect(() => {
    const now = Date.now();
    let nearest = Infinity;
    for (const c of conversations) {
      const until = c.mute_until ?? 0;
      if (c.muted && until > now && until < nearest) nearest = until;
    }
    if (!Number.isFinite(nearest)) return;
    // +50ms 余量：定时器精度不保证恰好到点触发，晚一点点确保此时 isMutedNow 已经翻成 false。
    const delay = Math.max(0, nearest - now) + 50;
    const timer = window.setTimeout(() => setTick((v) => v + 1), delay);
    return () => window.clearTimeout(timer);
  }, [conversations]);

  useEffect(() => {
    const refresh = () => setTick((v) => v + 1);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
}
