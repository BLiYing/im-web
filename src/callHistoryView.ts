// 「设置 ▸ 最近通话」纯逻辑（无 React 依赖，可单测）：未接判定、日期分组、群通话人数、
// 「全部/未接」过滤 + 自动续页判据、行文案。设计见 IMServer docs/design/CALL_HISTORY_DESIGN.md。
//
// reason 文案**复用 callRecord.ts**（与聊天气泡通话记录消息同一套判定，不重写一遍）——
// 但「未接」的判色/筛选用设计文档 §1/§4/§6 明文给的简化公式：`caller !== 我的uid && durationSec===0`，
// 刻意不排除被叫侧主动 reject 的边界（聊天气泡的 tone 判据会排除 reject，这里是设计文档拍板的 v1 简化，
// 三处原文一致：§0.6「判断"未接"只需要...」、§4「未接来电（我是被叫且 durationSec=0）」、
// §6 测试点 2「仅"我是被叫 且 durationSec=0"才红」）。
import type { CallHistoryRecord } from "im-rtc-call-engine";
import { buildCallRecord, renderCallRecord, type CallMedia } from "./callRecord";
import { dayHeader } from "./time";
import { t as i18nT, type Args } from "./i18n";

export type CallHistoryTab = "all" | "missed";

type Translate = (key: string, args?: Args) => string;

/** 未接判定：我是被叫（caller !== myUid）且 durationSec===0。见文件头注释——刻意不看 reason。 */
export function isMissedHistoryRecord(r: CallHistoryRecord, myUid: string): boolean {
  return r.caller !== myUid && r.durationSec === 0;
}

/** 「全部/未接」过滤：missed 只保留未接记录；all 原样返回（新数组，不共享引用）。 */
export function filterHistoryRecords(
  records: readonly CallHistoryRecord[], tab: CallHistoryTab, myUid: string,
): CallHistoryRecord[] {
  return tab === "all" ? [...records] : records.filter((r) => isMissedHistoryRecord(r, myUid));
}

/**
 * 群通话人数：`members.length` 加上「发起人是否已在 members 里」的边界修正——
 * 与 im-rtc-web Demo `CallHistory.tsx` 的 `peerText` 同一算法，不重新发明。
 */
export function groupCallSize(r: CallHistoryRecord): number {
  const extra = r.members.some((m) => m.uid === r.caller) ? 0 : 1;
  return Math.max(r.members.length, 1) + extra;
}

/**
 * 单聊对端 uid：我是被叫→`caller`；我是主叫→`members` 里第一个不是我的人（与 im-rtc-web Demo
 * `peerText` 同一逻辑）。拿不到（异常数据）返回空串，调用方兜底文案、不崩溃。
 */
export function callHistoryPeerUid(r: CallHistoryRecord, myUid: string): string {
  if (r.caller !== myUid) return r.caller;
  return r.members.find((m) => m.uid !== myUid)?.uid ?? "";
}

/** 「未接」tab 翻页后是否还要自动接着翻下一页：已加载的未接数不到一页量、且没到底（§3.5，UX 稿 §04 C）。 */
export function needsAutoContinue(
  tab: CallHistoryTab, records: readonly CallHistoryRecord[], myUid: string, nextCursor: number | null, pageSize: number,
): boolean {
  if (tab !== "missed" || nextCursor === null) return false;
  return filterHistoryRecords(records, "missed", myUid).length < pageSize;
}

/** 一组按自然日分好的记录（组内保持原有顺序，即倒序）。 */
export interface CallHistoryDayGroup {
  /** 本地日期 key（稳定排序/去重用，非展示文案）。 */
  key: string;
  /** dayHeader() 的展示文案（今天/昨天/日期），跟随当前界面语言。 */
  label: string;
  records: CallHistoryRecord[];
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * 按 `startedAtMs` 的自然日分组，与消息列表日期分隔胶囊同一套日期计算（`time.ts#dayHeader`），不重新实现。
 * 假定入参已按时间倒序（SDK/服务端保证，见设计文档 §1），只顺序扫描分桶，不重排。
 */
export function groupHistoryByDay(records: readonly CallHistoryRecord[]): CallHistoryDayGroup[] {
  const groups: CallHistoryDayGroup[] = [];
  for (const r of records) {
    const key = dayKey(r.startedAtMs);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.records.push(r);
    else groups.push({ key, label: dayHeader(r.startedAtMs), records: [r] });
  }
  return groups;
}

/** 一行的展示态：图标 + 副标题文案 + 未接（红字）+ 呼出/呼入。头像/名字要身份解析，留给组件层拼。 */
export interface CallHistoryLineView {
  icon: CallMedia;
  text: string;
  missed: boolean;
  outgoing: boolean;
}

/**
 * 一行的副标题文案：
 * - 单聊：复用 `callRecord.ts` 的 `buildCallRecord` + `renderCallRecord`（与聊天气泡通话记录消息同一套
 *   reason 判定顺序 / i18n 文案表），不重写一遍。
 * - 群聊：UX 稿 §02/§03 要的是「群{语音|视频}通话 · N人」，不是 `renderGroup()` 那句叙述式文案
 *   （那是气泡/系统条专用），故群聊单独拼，人数走 `groupCallSize`。
 */
export function callHistoryLine(r: CallHistoryRecord, myUid: string, translate: Translate = i18nT): CallHistoryLineView {
  const media: CallMedia = r.mediaType === "video" ? "video" : "audio";
  const missed = isMissedHistoryRecord(r, myUid);
  const outgoing = r.caller === myUid;
  if (r.isGroup) {
    const kind = translate(media === "video" ? "call.record.kind_video" : "call.record.kind_voice");
    return { icon: media, text: translate("call.history.group_subtitle", { kind, count: groupCallSize(r) }), missed, outgoing };
  }
  const content = buildCallRecord({ callId: r.callId, mediaType: media, reason: r.reason, durationSec: r.durationSec, isGroup: false });
  const rendered = content ? renderCallRecord(content, { viewerIsSender: outgoing, isGroup: false }, translate) : null;
  return { icon: media, text: rendered?.text ?? translate("call.record.not_connected"), missed, outgoing };
}
