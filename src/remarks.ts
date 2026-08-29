// remarks：好友备注名（仅本人可见）在**本机渲染**时的统一取值口径。
//
// 备注只影响"我这台机器上看到的名字"，绝不能进入任何会发出去的内容——
// 系统消息文本、合并转发条目名、@token 都必须用公开名，见 ../IMServer/docs/UI.md「备注 · 隐私红线」。
//
// 与 iOS `IMRemarkStore` 同语义；Web 侧不另设缓存，直接从 friends 派生（React 状态已是单一来源）。

import type { FriendEntry } from "./sdk/protocol";

/** uid → 我给他起的备注（已裁空白；无备注者不入表）。在组件里用 useMemo 包一层避免每帧重建。 */
export function remarkMap(friends: FriendEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of friends) {
    const r = f.remark?.trim();
    if (r) out.set(f.user_id, r);
  }
  return out;
}

/** 显示名兜底的**唯一口径**：`备注 → fallback（群昵称/昵称）→ @username → 「未命名用户」`。
 *
 *  **末级绝不是 uid**：账号体系重构后 uid 是 10 位随机数字内部 ID，露在界面上对用户毫无意义
 *  （见 ../IMServer/docs/UI.md「用户标识」）。nickname 在服务端是必填字段，走到后两级说明是
 *  脏数据/老数据，给句柄或占位都比给一串数字好。
 *
 *  ⚠️ 新增显示名逻辑一律走本函数。2026-08-29 排查曾发现 App.tsx 里另有 `labelOf`/`friendLabel`/
 *  `convLabel`/`peerLabel` 四条**独立**的链各自回退到 uid——那正是"改了这条没改那条"的来源。 */
export function displayNameOf(uid: string, remarks: Map<string, string>, fallback?: string | null, username?: string | null): string {
  const remark = remarks.get(uid);
  if (remark) return remark;
  if (fallback?.trim()) return fallback.trim();
  if (username?.trim()) return `@${username.trim()}`;
  return "未命名用户";
}

/** 无备注语境下的显示名兜底（找人结果、群成员气泡等还没有备注表的地方）。 */
export function displayNameNoRemark(fallback?: string | null, username?: string | null): string {
  return displayNameOf("", new Map(), fallback, username);
}
