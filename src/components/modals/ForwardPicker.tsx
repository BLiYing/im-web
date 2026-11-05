import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { Conversation } from "../../sdk/protocol";
import { ListSearchInput, isSearching } from "../ListSearchInput";
import { filterByQuery } from "../../listSearch";
import { buildTargetIndex, isSendableConv, prunedTargets, resolveTargets, searchShareSections } from "../../shareTargets";
import { MAX_FORWARD_TARGETS } from "../../useForward";
import { Modal } from "../Modal";
import { ConfirmPanel, PickRow, SectionHead, SelectedBar, SourceEntries } from "./SharePickerParts";
import { useT } from "../../i18n";

/** 好友 / 群两个额外来源（SHARE_PICKER_UX_SKETCH）。传了才出「我的好友 / 我的群聊」入口、底部已选栏与发送确认面板。 */
export type ShareSources = {
  /** 可选好友，已合成为会话形状（conv_id 按协议本地推导，见 shareTargets.friendTarget）。 */
  friends: Conversation[];
  /** 我的群（含会话已删的群），会话形状；null = 加载中或加载失败（看 groupsFailed）。 */
  groups: Conversation[] | null;
  /** 群列表拉取失败：「我的群聊」与主页群搜索显示「加载失败，点击重试」，点了调 onRetryGroups（不弹吐司）。 */
  groupsFailed?: boolean;
  onRetryGroups?: () => void;
  /** 确认面板里的待发内容预览（如「[名片] 张三」/ 群邀请文案 / 消息摘要）。 */
  preview?: string;
};

type View = "main" | "friends" | "groups";

/** 转发 / 分享会话选择器（M4-3 + SHARE_PICKER_UX_SKETCH）：默认单选点一下即发；「多选」切换成勾选态。
 *  纯展示：会话列表与显示名/头像解析、动作全部由宿主注入；搜索词 / 当前视图 / 确认面板开关是纯 UI 局部状态。
 *
 *  **选中集只存 conv_id**（targets，App 的 useForward 持有，上限 MAX_FORWARD_TARGETS 合计）：最近聊天、好友、群
 *  三处共用，同一个人 / 群在哪个列表勾选状态都一致。返回子视图不清选中，关窗（取消 / 发送完成）才清。
 *
 *  **「添加例外」（NOTIFICATIONS_P1_DESIGN §2）复用本组件**：不传 `sources` → 不出入口行、不出已选栏，行为与改造前一致；
 *  再靠 `filter`/`title`/`hideMultiToggle`/`footer`/`emptyText` 收窄成选择页。 */
export function ForwardPicker({
  count, conversations, multi, mode, targets, convAvatarUrl, convDisplayLabel,
  onToggleMulti, onSetMode, onToggleTarget, onForward, onClose,
  filter, title, hideMultiToggle, footer, emptyText, sources, exclude, onPruneTargets,
}: {
  count: number; // 待转发消息条数
  conversations: Conversation[];
  multi: boolean;
  mode: "each" | "merged";
  targets: string[];
  convAvatarUrl: (c: Conversation) => string | undefined;
  convDisplayLabel: (c: Conversation) => string;
  onToggleMulti: () => void;
  onSetMode: (mode: "each" | "merged") => void;
  onToggleTarget: (convId: string) => void;
  onForward: (convs: Conversation[]) => void; // 单选传 [c]；多选传选中的目标（勾选顺序）
  onClose: () => void;
  /** 额外过滤（在系统通知会话排除之后再收窄），如「添加例外」只列 `isMutedNow===false` 的会话；省略 = 不额外过滤。 */
  filter?: (c: Conversation) => boolean;
  /** 覆盖标题（默认按 count 拼「转发(N)」）；「添加例外」传 `notif.exceptions.add` 文案。 */
  title?: string;
  /** 隐藏右上角「多选」切换（「添加例外」恒单选，不提供多选）。 */
  hideMultiToggle?: boolean;
  /** 列表下方的说明文案（如「只列私聊中还没有免打扰的会话」）；省略 = 不显示。 */
  footer?: string;
  /** 列表为空（非搜索导致）时的文案覆盖；省略 = 用 `forward.picker.empty`。 */
  emptyText?: string;
  /** 好友 / 群来源；省略 = 只选已有会话（「添加例外」）。 */
  sources?: ShareSources;
  /** 三个来源统一不列出的 conv_id（发群邀请排除该群、推荐名片排除与本人的单聊）。 */
  exclude?: string[];
  /** 来源加载齐后，把已解析不到的选中 id（中途被删 / 拉黑的好友等）剔掉，回传保留下来的有序选中集。
   *  否则它们不显示却占着 9 个名额。群列表还在加载 / 加载失败时不剔——那时群 id 解析不到是正常的。 */
  onPruneTargets?: (keep: string[]) => void;
}) {
  const tr = useT();
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("main");
  const [subQ, setSubQ] = useState("");
  const [confirming, setConfirming] = useState(false);
  // 可转发目标 = 会话全集减去「系统通知」单聊：那是只读会话，服务端直接拒 send_msg to=system
  // （护栏见 IMServer/docs/design/SYSTEM_NOTICE_SESSION_DESIGN.md §2.2），列出来只会点了报错。
  // **过滤放在这一层**：转发消息 / 收藏转发 / 推荐名片 / 添加例外四个入口都汇到本组件，一处挡住即可。
  // exclude 在这里对三个来源**一次性**生效（最近聊天 / 好友 / 群），搜索、子页、索引都从这三份派生，不必各处再滤。
  const excluded = useMemo(() => new Set(exclude ?? []), [exclude]);
  const keep = useCallback((c: Conversation) => !excluded.has(c.conv_id), [excluded]);
  const selectable = useMemo(
    () => conversations.filter(isSendableConv).filter((c) => (filter ? filter(c) : true)).filter(keep),
    [conversations, filter, keep]);
  const friends = useMemo(() => (sources?.friends ?? []).filter(keep), [sources?.friends, keep]);
  const groups = useMemo(() => (sources?.groups ?? []).filter(keep), [sources?.groups, keep]);
  const groupsLoaded = !!sources && sources.groups !== null && !sources.groupsFailed;
  // 备注参与匹配是安全的：本选择器只在本机显示，转发出去的是消息本身、不含任何名字。
  const sections = useMemo(
    () => searchShareSections(q, selectable, friends, groups, convDisplayLabel),
    [q, selectable, friends, groups, convDisplayLabel]);
  const index = useMemo(() => buildTargetIndex(selectable, friends, groups), [selectable, friends, groups]);
  // 刻意按 targets（勾选顺序）从**全集索引**取，而非可见行：先勾选、再搜索把它过滤掉的目标仍要发出去。
  const chosen = useMemo(() => resolveTargets(targets, index), [targets, index]);
  const chips = chosen.map((c) => ({ id: c.conv_id, label: convDisplayLabel(c), url: convAvatarUrl(c), seed: c.is_group ? c.conv_id : c.peer }));

  // 确认面板里删到 0 个 → 关面板回列表（不能只靠渲染时隐藏：留着 confirming=true，下次一勾选它又会自己弹出来）。
  useEffect(() => { if (confirming && chosen.length === 0) setConfirming(false); }, [confirming, chosen.length]);
  // 幽灵选中：来源齐了还解析不到的 id 剔掉（见 onPruneTargets）。
  useEffect(() => {
    if (!groupsLoaded || !onPruneTargets) return;
    const kept = prunedTargets(targets, index);
    if (kept.length !== targets.length) onPruneTargets(kept);
  }, [groupsLoaded, onPruneTargets, targets, index]);

  const rowOf = (c: Conversation) => (
    <PickRow key={c.conv_id} c={c} multi={multi} on={targets.includes(c.conv_id)}
      label={convDisplayLabel(c)} avatarUrl={convAvatarUrl(c)}
      onClick={() => (multi ? onToggleTarget(c.conv_id) : onForward([c]))} />
  );
  const openSub = (v: View) => { setSubQ(""); setView(v); };
  const empty = (text: string) => <div className="fwd-empty">{text}</div>;
  const retry = () => (
    <button className="fwd-empty fwd-retry" onClick={sources?.onRetryGroups}>{tr("share.picker.load_failed_retry")}</button>
  );

  const mainList = () => {
    if (!sources) {
      const visible = sections.recent;
      return <>{visible.length === 0 && empty(isSearching(q) ? tr("forward.picker.no_match") : (emptyText ?? tr("forward.picker.empty")))}{visible.map(rowOf)}</>;
    }
    if (isSearching(q)) {
      const { recent, friends: fs, groups: gs } = sections;
      const failed = !!sources.groupsFailed;
      if (recent.length + fs.length + gs.length === 0 && !failed) return empty(tr("forward.picker.no_match"));
      return (
        <>
          {recent.length > 0 && <><SectionHead text={tr("share.picker.recent")} />{recent.map(rowOf)}</>}
          {fs.length > 0 && <><SectionHead text={tr("share.picker.section_friends")} />{fs.map(rowOf)}</>}
          {(gs.length > 0 || failed) && <><SectionHead text={tr("share.picker.section_groups")} />{failed ? retry() : gs.map(rowOf)}</>}
        </>
      );
    }
    return (
      <>
        <SourceEntries onFriends={() => openSub("friends")} onGroups={() => openSub("groups")} />
        <SectionHead text={tr("share.picker.recent")} />
        {selectable.length === 0 ? empty(emptyText ?? tr("forward.picker.empty")) : selectable.map(rowOf)}
      </>
    );
  };

  const subList = () => {
    const isFriends = view === "friends";
    if (!isFriends && sources?.groupsFailed) return retry();
    if (!isFriends && sources?.groups == null) return empty(tr("common.loading"));
    // 经全集索引取：已有会话优先（带群备注 / 好友备注等），与「最近聊天」里同一目标显示名、搜索口径一致。
    const all = (isFriends ? friends : groups).map((c) => index.get(c.conv_id) ?? c);
    const visible = filterByQuery(all, subQ, (c) => [convDisplayLabel(c), c.peer]);
    if (visible.length === 0) {
      return empty(isSearching(subQ) ? tr("forward.picker.no_match") : tr(isFriends ? "share.picker.no_friends" : "share.picker.no_groups"));
    }
    return visible.map(rowOf);
  };

  const showBar = !!sources && multi;
  return (
    <Modal className={`modal fwd-picker${sources ? " fwd-share" : ""}`} onClose={onClose}>
        <div className="modal-title fwd-title">
          <span className="fwd-title-main">
            {view === "main"
              ? <span>{title ?? tr("forward.picker.title", { count })}</span>
              : (
                <button className="fwd-back" onClick={() => setView("main")}>
                  <ChevronLeft size={18} />{tr(view === "friends" ? "share.picker.my_friends" : "share.picker.my_groups")}
                </button>
              )}
            {showBar && <span className="fwd-count">{tr("share.picker.selected_of_max", { count: chosen.length, max: MAX_FORWARD_TARGETS })}</span>}
          </span>
          {!hideMultiToggle && (
            <button className="section-action" onClick={onToggleMulti}>
              {multi ? tr("forward.picker.multi_cancel") : tr("forward.picker.multi")}
            </button>
          )}
        </div>
        {count > 1 && view === "main" && (
          <div className="fwd-mode">
            <button className={mode === "each" ? "on" : ""} onClick={() => onSetMode("each")}>{tr("forward.mode.each")}</button>
            <button className={mode === "merged" ? "on" : ""} onClick={() => onSetMode("merged")}>{tr("forward.mode.merged")}</button>
          </div>
        )}
        {view === "main"
          ? <ListSearchInput value={q} onChange={setQ} placeholder={tr("forward.picker.search_placeholder")} />
          : <ListSearchInput key={view} value={subQ} onChange={setSubQ}
              placeholder={tr(view === "friends" ? "share.picker.search_friends" : "share.picker.search_groups")} />}
        <div className="fwd-list">{view === "main" ? mainList() : subList()}</div>
        {footer && <div className="fwd-foot">{footer}</div>}
        {showBar && <SelectedBar chips={chips} max={MAX_FORWARD_TARGETS} onRemove={onToggleTarget} onSend={() => setConfirming(true)} />}
        {multi && !sources ? (
          <div className="fwd-actions">
            <button className="link" onClick={onClose}>{tr("common.cancel")}</button>
            <button className="mini-btn" disabled={targets.length === 0} onClick={() => onForward(chosen)}>
              {targets.length > 0 ? tr("common.send_count", { count: targets.length }) : tr("common.send")}
            </button>
          </div>
        ) : (
          <button className="modal-close" onClick={onClose}>{tr("common.cancel")}</button>
        )}
        {confirming && chosen.length > 0 && (
          <ConfirmPanel chips={chips} preview={sources?.preview} onRemove={onToggleTarget}
            onCancel={() => setConfirming(false)} onSend={() => { setConfirming(false); onForward(chosen); }} />
        )}
    </Modal>
  );
}
