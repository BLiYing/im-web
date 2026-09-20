// 通话记录消息的两种呈现（设计 CALL_RECORD_DESIGN §3 / UX 稿 §03、§04）：
//  · 单聊：普通气泡壳里的「图标 + 文字」（时间/勾由 MessageList 的通用 metaNode 画在同一气泡内）；
//  · 群聊：居中系统条（复用 .sys-line 日期胶囊外观），不可点。
// 图标只靠电话 / 摄像机区分语音与视频（点击回拨要保持原类型）。颜色全走 CSS 变量令牌，见 styles.css `.call-rec`。
import type { RefObject } from "react";
import { Phone, Video } from "lucide-react";
import type { CallRender } from "../callRecord";

/** 气泡内的图标 + 文字。 */
export function CallRecordBody({ view }: { view: CallRender }) {
  const Icon = view.icon === "video" ? Video : Phone;
  return (
    <span className={`call-rec${view.tone === "missed" ? " missed" : ""}`}>
      <Icon className="call-rec-icon" fill="currentColor" aria-hidden="true" />
      <span className="call-rec-text">{view.text}</span>
    </span>
  );
}

/** 群系统条 / 解析失败的旧版兜底：一行居中灰条（日期胶囊 / 未读分割线与其它消息行同款）。 */
export function CallSysItem({ seq, text, dateLabel, unread, dividerRef }: {
  seq: number; text: string; dateLabel: string; unread: boolean; dividerRef: RefObject<HTMLDivElement>;
}) {
  return (
    <div className="msg-item" data-seq={seq}>
      {dateLabel && <div className="date-pill"><span>{dateLabel}</span></div>}
      {unread && <div className="unread-divider" ref={dividerRef}><span>未读消息</span></div>}
      <div className="sys-line"><span>{text}</span></div>
    </div>
  );
}
