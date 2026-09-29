// 「设置 ▸ 最近通话」面板：只读通话历史（含群通话），点单聊行按原类型直接回拨，点群聊行跳转群会话。
// 设计见 IMServer docs/design/CALL_HISTORY_DESIGN.md，配套 UX 稿 sketches/CALL_HISTORY_UX_SKETCH.html §02-§05。
// 数据/分页/筛选逻辑在 useCallHistory（状态）+ callHistoryView（纯函数）；本文件只管渲染与身份解析的胶水。
import { useMemo, type UIEvent } from "react";
import { ArrowDownLeft, ArrowUpRight, Phone, Users, Video } from "lucide-react";
import type { CallHistoryRecord } from "im-rtc-call-engine";
import { Modal } from "./Modal";
import { Avatar } from "./Avatar";
import { useT } from "../i18n";
import { formatTime, type TimeFormat } from "../time";
import { placeSingleCall } from "../rtc/rtcCall";
import { useCallHistory } from "../useCallHistory";
import {
  callHistoryLine, callHistoryPeerUid, filterHistoryRecords, groupHistoryByDay, type CallHistoryTab,
} from "../callHistoryView";

/** 四态穷尽一个值，不用四个手写布尔各自重复算一遍三分支条件（/code-review 2026-09-29：
 * 原先 catchingUp/showEmpty/showError/showLoading 各自取反拼一遍，容易改一处漏一处，
 * 出现"哪个都不是"或"两个同时是真"的态，界面会静默地空着或对不上）。
 * 优先级与原判据完全等价：有数据先显列表；否则不在加载中时，出错显错误、其余条件都不成立显空态；
 * 剩下的情况（仍在加载 / 或"未接"tab 还在自动续页且暂无过滤后数据）统一算作 loading。 */
function callHistoryViewStateOf(hasRows: boolean, loading: boolean, error: string, hasMore: boolean): "list" | "error" | "empty" | "loading" {
  if (hasRows) return "list";
  if (!loading && error) return "error";
  if (!loading && !error && !hasMore) return "empty";
  return "loading";
}

export interface CallHistoryPanelProps {
  myUid: string;
  timeFormat: TimeFormat;
  /** 1v1 对端身份解析（备注 > 昵称 > @句柄），与通话界面同一条链（App 传入 rtcNameOf 组合）。 */
  nameOf: (uid: string) => string | undefined;
  avatarOf: (uid: string) => string | undefined;
  /** 群通话所属会话（chatGroupId = 群 conv_id）的显示名；拿不到时行内退回「群{kind}通话 · N人」。 */
  groupNameOf: (chatGroupId: string) => string | undefined;
  /** 跳转到群会话（不提供「加入」，见设计文档 §0.2）。 */
  onOpenGroup: (chatGroupId: string) => void;
  /** 回拨走不通（未就绪/忙线由 Kit 自己兜底，这里只处理「服务没起来」）时的提示，通常是 setToast(...)。 */
  onCallUnavailable: () => void;
  onClose: () => void;
}

const TABS: CallHistoryTab[] = ["all", "missed"];

export function CallHistoryPanel({
  myUid, timeFormat, nameOf, avatarOf, groupNameOf, onOpenGroup, onCallUnavailable, onClose,
}: CallHistoryPanelProps) {
  const tr = useT();
  const { records, tab, setTab, loading, error, hasMore, loadMore, retry } = useCallHistory(myUid);
  // 过滤 + 按日分组只在 records/tab/myUid 真的变化时才重算（/code-review 2026-09-29：原先每次
  // 渲染都重新做一遍，父组件任何无关状态变化——包括下面提到的 App.tsx 传入的解析函数每次渲染
  // 重建——都会顺带把这个 O(n) 计算白跑一遍）。
  const filtered = useMemo(() => filterHistoryRecords(records, tab, myUid), [records, tab, myUid]);
  const groups = useMemo(() => groupHistoryByDay(filtered), [filtered]);

  // 四态判据（§4 见文件头设计文档链接）见上面 callHistoryViewStateOf 的注释。
  const viewState = callHistoryViewStateOf(filtered.length > 0, loading, error, hasMore);
  const showLoading = viewState === "loading";
  const showEmpty = viewState === "empty";
  const showError = viewState === "error";

  const handleRowClick = (r: CallHistoryRecord) => {
    if (r.isGroup) { onClose(); onOpenGroup(r.chatGroupId); return; }
    const peer = callHistoryPeerUid(r, myUid);
    if (!peer || !placeSingleCall(peer, r.mediaType === "video")) onCallUnavailable();
  };

  const onListScroll = (e: UIEvent<HTMLDivElement>) => {
    if (loading || !hasMore) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) loadMore();
  };

  const errorText = error === "auth" ? tr("common.error.not_logged_in") : tr("call.history.load_failed");

  return (
    <Modal className="modal callh-modal" onClose={onClose}>
      <div className="modal-title">{tr("ios.settings.row.recent_calls")}</div>
      <div className="callh-seg">
        {TABS.map((tb) => (
          <button key={tb} className={`callh-seg-opt${tab === tb ? " on" : ""}`} onClick={() => setTab(tb)}>
            {tr(tb === "all" ? "call.history.tab_all" : "call.history.tab_missed")}
          </button>
        ))}
      </div>

      {showLoading ? (
        <div className="callh-state">{tr("common.loading")}</div>
      ) : showEmpty ? (
        <div className="callh-state callh-empty"><Phone size={40} /><span>{tr("call.history.empty")}</span></div>
      ) : showError ? (
        <button className="callh-state callh-retry" onClick={retry}>{errorText}</button>
      ) : (
        <div className="callh-list" onScroll={onListScroll}>
          {groups.map((g) => (
            <div key={g.key}>
              <div className="callh-day">{g.label}</div>
              {g.records.map((r) => (
                <CallHistoryRow key={r.callId} r={r} myUid={myUid} nameOf={nameOf} avatarOf={avatarOf}
                  groupNameOf={groupNameOf} timeFormat={timeFormat} tr={tr} onClick={() => handleRowClick(r)} />
              ))}
            </div>
          ))}
          {loading && <div className="callh-foot">{tr("common.loading")}</div>}
          {!loading && error && <button className="callh-foot callh-foot-retry" onClick={retry}>{errorText}</button>}
        </div>
      )}

      <button className="modal-close" onClick={onClose}>{tr("common.close")}</button>
    </Modal>
  );
}

/** 一行：头像 + 名字(含方向箭头，未接红字) + 媒体图标与文案 + 右侧时间。群通话用统一渐变底图标，不用群头像（见设计文档 §3）。 */
function CallHistoryRow({ r, myUid, nameOf, avatarOf, groupNameOf, timeFormat, tr, onClick }: {
  r: CallHistoryRecord;
  myUid: string;
  nameOf: (uid: string) => string | undefined;
  avatarOf: (uid: string) => string | undefined;
  groupNameOf: (chatGroupId: string) => string | undefined;
  timeFormat: TimeFormat;
  tr: (key: string, args?: Record<string, string | number>) => string;
  onClick: () => void;
}) {
  const line = callHistoryLine(r, myUid, tr);
  const peer = r.isGroup ? "" : callHistoryPeerUid(r, myUid);
  const name = r.isGroup
    ? (groupNameOf(r.chatGroupId) || line.text)
    : (peer ? (nameOf(peer) || tr("common.unnamed_user")) : tr("common.unknown"));
  const DirIcon = line.outgoing ? ArrowUpRight : ArrowDownLeft;
  const MediaIcon = line.icon === "video" ? Video : Phone;
  return (
    <div className={`callh-row${line.missed ? " missed" : ""}`} onClick={onClick} role="button">
      {r.isGroup
        ? <div className="callh-avatar callh-avatar-group"><Users size={18} /></div>
        : <Avatar url={avatarOf(peer)} label={name} seed={peer || name} cls="avatar callh-avatar" />}
      <div className="callh-mid">
        <div className="callh-name"><DirIcon size={13} className="callh-dir" /><span>{name}</span></div>
        <div className="callh-sub"><MediaIcon size={12} className="callh-sub-icon" /><span>{line.text}</span></div>
      </div>
      <div className="callh-time">{formatTime(r.startedAtMs, timeFormat)}</div>
    </div>
  );
}
