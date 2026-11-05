import type { ReactNode } from "react";
import { Avatar } from "./Avatar";
import { useT } from "../i18n";

export type MemberChipItem = { id: string; label: string; url?: string; seed: string };

/** 已选成员条：头像 + 名字 + ✕，按传入顺序排列。
 *  从建群第二步（CreateGroupModal 成员回显）抽出，分享选择页底部已选栏 / 发送确认面板共用同一个组件
 *  （SHARE_PICKER_UX_SKETCH ④）。容器类走 `className`：建群用默认 `member-chips`（换行），
 *  选择页用 `member-chips fwd-strip`（单行横向滚动）。`children` 追加在末尾（建群的「＋ 添加」）。 */
export function MemberChips({ items, onRemove, className = "member-chips", children }: {
  items: MemberChipItem[];
  onRemove: (id: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  const tr = useT();
  return (
    <div className={className}>
      {items.map((it) => (
        <span className="member-chip" key={it.id}>
          <Avatar url={it.url} label={it.label} seed={it.seed} cls="avatar chip-av" />
          <span className="chip-name">{it.label}</span>
          <button className="chip-x" title={tr("common.remove")} onClick={() => onRemove(it.id)}>✕</button>
        </span>
      ))}
      {children}
    </div>
  );
}
