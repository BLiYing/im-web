import { normalizeQuery } from "../listSearch";

/** 列表页统一搜索框（转发选择 / 邀请成员 / 建群选好友共用）。
 *  纯受控：状态留在各自弹窗（搜索词是纯 UI 局部态，关窗即弃，没有跨组件消费者）。 */
export function ListSearchInput({ value, onChange, placeholder, className = "list-search" }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <input className={className} value={value} placeholder={placeholder} aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)} />
  );
}

/** 该查询词下是否"正在搜"——空态文案要据此在「暂无」与「无匹配」之间切换。 */
export const isSearching = (q: string) => normalizeQuery(q).length > 0;
