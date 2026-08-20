// 搜索命中词高亮（SEARCH_DESIGN §4/§13.5）：把命中的关键词子串包进 <mark class="search-hit">
// （底色走 --accent-flash 语义变量，非硬编码黄）。无词 → 原样返回文本，不影响正常渲染。
// 纯函数，从 App.tsx 抽出（控制 App 体量，CODING_STYLE §7）；会话内搜索命中导航与首页聊天记录摘要共用。
import type { ReactNode } from "react";

export function highlightText(text: string, needle: string, keyBase: string): ReactNode {
  const q = needle.trim().toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx < 0) { parts.push(text.slice(i)); break; }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={`${keyBase}-${k++}`} className="search-hit">{text.slice(idx, idx + q.length)}</mark>);
    i = idx + q.length;
  }
  return parts;
}
