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

/** 本机显示名：我给他起的备注 > fallback（群昵称/昵称）> uid。各处取显示名的统一入口。 */
export function displayNameOf(uid: string, remarks: Map<string, string>, fallback?: string | null): string {
  return remarks.get(uid) || (fallback?.trim() ? fallback.trim() : uid);
}
