// ChatSearchBar：会话内搜索条（替换聊天标题栏内容，SEARCH_DESIGN §4/§5）。
// 从 App.tsx 平移的**纯展示组件**（状态/逻辑仍在 App，经 props 注入）——仅为控制 App.tsx 体量（CODING_STYLE §7），
// 行为不变：搜索框 + 命中导航 ▲▼ + 👤 来自下拉 + 📅 日历 popover（含最早/今天）。
import { Search, ChevronUp, ChevronDown, User, Calendar, X } from "lucide-react";
import { Avatar } from "./Avatar";

export type FromRow = { label: string; userId: string; role?: string; avatarUrl?: string };

export function ChatSearchBar(p: {
  searchInputRef: React.RefObject<HTMLInputElement>;
  isGroupChat: boolean;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchNeedle: string;
  searchHitCount: number;
  /** 命中集被服务端单页上限截断（真实命中更多）→ 计数补 `+`。 */
  searchHitsTruncated?: boolean;
  searchHitIdx: number;
  gotoSearchHit: (idx: number) => void;
  closeInChatSearch: () => void;
  // 来自
  searchFrom: string;
  searchFromName: string;
  clearSearchFrom: () => void;
  searchFromPickerOpen: boolean;
  setSearchFromPickerOpen: (v: boolean) => void;
  searchFromRows: FromRow[];
  openFromPicker: () => void;
  pickSearchFrom: (userId: string, label: string) => void;
  // 日历
  calendarOpen: boolean;
  setCalendarOpen: (fn: (v: boolean) => boolean) => void;
  calendarMonth: { y: number; m: number };
  setCalendarMonth: (fn: (c: { y: number; m: number }) => { y: number; m: number }) => void;
  activeDays: Set<string>;
  jumpToDay: (ts: number, label: string) => void;
  jumpToEarliest: () => void;
  jumpToToday: () => void;
  monthLabel: (d: Date) => string;
}) {
  const { calendarMonth, activeDays } = p;
  return (
    <>
      <div className="chat-search-bar">
        <Search size={16} className="chat-search-lead" />
        {p.searchFromPickerOpen && <span className="chat-search-fromprefix">来自:</span>}
        {p.searchFrom && !p.searchFromPickerOpen && (
          <span className="from-token">来自:{p.searchFromName || p.searchFrom}
            <button className="from-token-x" title="清除发件人" onClick={p.clearSearchFrom}><X size={11} /></button>
          </span>
        )}
        {/* 输入框始终编辑关键词（下拉不做打字过滤，候选=已发言者，对齐 iOS 2026-08-20 拍板）。 */}
        <input
          ref={p.searchInputRef}
          className="chat-search-input"
          value={p.searchQuery}
          placeholder={p.searchFromPickerOpen ? "选择发件人…" : "搜索聊天内容"}
          onChange={(e) => p.setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); p.searchFromPickerOpen ? p.setSearchFromPickerOpen(false) : p.closeInChatSearch(); } }}
        />
        {(p.searchNeedle || p.searchFrom) && !p.searchFromPickerOpen && (
          <span className="chat-search-nav">
            <span className="chat-search-count">{p.searchHitCount ? `${p.searchHitIdx + 1} / ${p.searchHitCount}${p.searchHitsTruncated ? "+" : ""}` : "无匹配"}</span>
            <button className="icon-btn chat-search-arrow" title="上一条（更旧）" disabled={p.searchHitCount === 0 || p.searchHitIdx <= 0}
              onClick={() => p.gotoSearchHit(p.searchHitIdx - 1)}><ChevronUp size={16} /></button>
            <button className="icon-btn chat-search-arrow" title="下一条（更新）" disabled={p.searchHitCount === 0 || p.searchHitIdx >= p.searchHitCount - 1}
              onClick={() => p.gotoSearchHit(p.searchHitIdx + 1)}><ChevronDown size={16} /></button>
          </span>
        )}
        {p.isGroupChat && !p.searchFrom && !p.searchFromPickerOpen && (
          <button className="icon-btn chat-search-icbtn" title="来自某成员" onClick={p.openFromPicker}><User size={16} /></button>
        )}
        <button className={`icon-btn chat-search-icbtn${p.calendarOpen ? " active" : ""}`} title="按日期"
          onClick={() => { p.setSearchFromPickerOpen(false); p.setCalendarOpen((v) => !v); }}><Calendar size={16} /></button>
        <button className="chat-search-cancel" onClick={p.closeInChatSearch}>取消</button>
      </div>
      {/* 👤 来自：群成员下拉（取向 C，复用群成员数据 + @ 打字过滤），锚在标题栏下方。 */}
      {p.searchFromPickerOpen && (
        <div className="chat-from-pick">
          <div className="chat-from-lbl">选择发件人</div>
          <div className="chat-from-scroll">
            {p.searchFromRows.length > 0 ? p.searchFromRows.map((r) => (
              <button key={r.userId} className="chat-from-row" onClick={() => p.pickSearchFrom(r.userId, r.label)}>
                <Avatar label={r.label} seed={r.userId} url={r.avatarUrl} cls="avatar mention-avatar" />
                <span className="mention-name">{r.label}</span>
                {r.role === "owner" && <span className="role-badge owner">群主</span>}
                {r.role === "admin" && <span className="role-badge">管理员</span>}
              </button>
            )) : <div className="mention-empty">暂无可筛选的发件人</div>}
          </div>
        </div>
      )}
      {/* 📅 日历 popover：选日跳当天首条；「最早 / 今天」快捷（SEARCH_DESIGN §5.1）。 */}
      {p.calendarOpen && (
        <div className="chat-cal-pop">
          {(() => {
            const view = new Date(calendarMonth.y, calendarMonth.m, 1);
            const firstDow = view.getDay();
            const daysInMonth = new Date(calendarMonth.y, calendarMonth.m + 1, 0).getDate();
            const cells: (number | null)[] = [];
            for (let i = 0; i < firstDow; i++) cells.push(null);
            for (let d = 1; d <= daysInMonth; d++) cells.push(d);
            const today = new Date();
            return (
              <>
                <div className="chat-cal-head">
                  <button className="icon-btn" title="上个月" onClick={() => p.setCalendarMonth((c) => { const d = new Date(c.y, c.m - 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; })}><ChevronUp size={16} style={{ transform: "rotate(-90deg)" }} /></button>
                  <span className="chat-cal-title">{p.monthLabel(view)}</span>
                  <button className="icon-btn" title="下个月" onClick={() => p.setCalendarMonth((c) => { const d = new Date(c.y, c.m + 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; })}><ChevronDown size={16} style={{ transform: "rotate(-90deg)" }} /></button>
                </div>
                <div className="chat-cal-dow">{["日", "一", "二", "三", "四", "五", "六"].map((w) => <span key={w}>{w}</span>)}</div>
                <div className="chat-cal-grid">
                  {cells.map((d, i) => {
                    if (d === null) return <span key={`e${i}`} className="chat-cal-day empty" />;
                    const isToday = today.getFullYear() === calendarMonth.y && today.getMonth() === calendarMonth.m && today.getDate() === d;
                    const has = activeDays.has(`${calendarMonth.y}-${calendarMonth.m}-${d}`);
                    return (
                      <button key={d} className={`chat-cal-day${isToday ? " today" : ""}${has ? " has" : ""}`}
                        onClick={() => p.jumpToDay(new Date(calendarMonth.y, calendarMonth.m, d, 0, 0, 0, 0).getTime(), `${calendarMonth.m + 1}月${d}日`)}>{d}</button>
                    );
                  })}
                </div>
                <div className="chat-cal-quick">
                  <button className="chat-cal-q" onClick={p.jumpToEarliest}>最早</button>
                  <button className="chat-cal-q" onClick={p.jumpToToday}>今天</button>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </>
  );
}
