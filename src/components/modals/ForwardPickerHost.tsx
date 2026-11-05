// ForwardPickerHost：App 里所有「应用内分享」入口（转发单条/多条、收藏转发、推荐名片、分享我的名片、群码发送给朋友）
// 共用的转发选择页宿主。它在 ForwardPicker 之外补齐「我的好友 / 我的群聊」两个来源（SHARE_PICKER_UX_SKETCH）：
//   · 好友：App 已有的好友表 → pickableFriends → 合成会话形状（conv_id 本地推导）；
//   · 群：打开选择页时拉一次 GET /api/v1/groups（含会话已删的群；接口不带禁言/角色/人数，故不置灰任何群）；
//     失败**不弹吐司**（打开就报错太吵），「我的群聊」/ 主页群搜索就地显示「加载失败，点击重试」；
//     好友来自 App 已有的好友表、不在这里拉，没有失败态；
//   · 预览：由待发消息派生（forwardPreview），名片 →「[名片] 昵称」、群邀请 → 邀请文案、其余同会话列表口径。
// 「添加例外」不走这里（NotificationsPanel 直接用 ForwardPicker、不传 sources），行为保持不变。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Conversation, FriendEntry } from "../../sdk/protocol";
import { useAppServices } from "../../AppServicesContext";
import { forwardPreview, friendTarget, groupTarget, pickableFriends } from "../../shareTargets";
import { LOG_TAG, logger } from "../../logging/logger";
import { ForwardPicker } from "./ForwardPicker";

export function ForwardPickerHost({ forwarding, uid, friends, setTargets, ...rest }: {
  forwarding: ChatMessage[];
  /** 选择页统一不列出的 conv_id（useForward.forwardExclude）。 */
  exclude: string[];
  /** 剔除幽灵选中后回写选中集（useForward.setForwardTargets）。 */
  setTargets: (ids: string[]) => void;
  uid: string;
  friends: FriendEntry[];
  conversations: Conversation[];
  multi: boolean;
  mode: "each" | "merged";
  targets: string[];
  convAvatarUrl: (c: Conversation) => string | undefined;
  convDisplayLabel: (c: Conversation) => string;
  onToggleMulti: () => void;
  onSetMode: (mode: "each" | "merged") => void;
  onToggleTarget: (convId: string) => void;
  onForward: (convs: Conversation[]) => void;
  onClose: () => void;
}) {
  const { clientRef } = useAppServices();
  const [groups, setGroups] = useState<Conversation[] | null>(null);
  const [groupsFailed, setGroupsFailed] = useState(false);
  const aliveRef = useRef(true);

  // 每次打开选择页拉一次（宿主随 forwarding 挂载/卸载）：群列表变化不频繁，不做跨次缓存，免得退群后还列着。
  const loadGroups = useCallback(() => {
    const client = clientRef.current;
    if (!client) { setGroupsFailed(true); return; }
    setGroupsFailed(false);
    setGroups(null);
    client.listGroups().then(
      (list) => { if (aliveRef.current) setGroups(list.map(groupTarget)); },
      (e: unknown) => {
        logger.warn(LOG_TAG.app, "share_picker_groups_failed", { error: (e as Error).message });
        if (aliveRef.current) setGroupsFailed(true);
      });
  }, [clientRef]);
  useEffect(() => {
    aliveRef.current = true;
    loadGroups();
    return () => { aliveRef.current = false; };
  }, [loadGroups]);

  const friendTargets = useMemo(() => pickableFriends(friends, uid).map((f) => friendTarget(uid, f)), [friends, uid]);
  const preview = useMemo(() => forwardPreview(forwarding, rest.mode), [forwarding, rest.mode]);
  const sources = useMemo(() => ({ friends: friendTargets, groups, groupsFailed, onRetryGroups: loadGroups, preview }),
    [friendTargets, groups, groupsFailed, loadGroups, preview]);

  return <ForwardPicker count={forwarding.length} sources={sources} onPruneTargets={setTargets} {...rest} />;
}
