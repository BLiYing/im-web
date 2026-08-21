// 搜索命中判定 + 命中摘要（纯函数，从 App.tsx 抽出控制体量，CODING_STYLE §7；配 searchPredicate.test.ts）。
// 口径与 sdk/localStore.matchesQuery、后端 G4、iOS 本地一致：**text 的 content / 任意 caption / file_name**
// 大小写不敏感子串；媒体/文件的 content 是 URL，不参与（撞 URL 片段会命中看不见文字的消息）。needle 须已 trim+lowercase。

type Matchable = { contentType?: string; content?: string; caption?: string; fileName?: string };

/** needle 空 → false。text 的 content / 任意 caption / file_name 命中即 true。 */
export function messageMatchesNeedle(m: Matchable, needle: string): boolean {
  if (!needle) return false;
  const isText = !m.contentType || m.contentType === "text";
  return (isText && (m.content || "").toLowerCase().includes(needle))
    || (m.caption || "").toLowerCase().includes(needle)
    || (m.fileName || "").toLowerCase().includes(needle);
}

/**
 * 命中摘要：优先展示**真正含 needle 的字段**（否则文件名命中却显 caption → 副行无高亮、像误命中，/code-review #3）。
 * 顺序同命中口径（caption > text content > file_name）；needle 空或都不含时回退 caption > fileName > content。
 */
export function hitSnippet(r: Matchable, needle: string): string {
  const isText = !r.contentType || r.contentType === "text";
  const has = (s?: string) => !!needle && !!s && s.toLowerCase().includes(needle);
  return (has(r.caption) && r.caption!) || (isText && has(r.content) && r.content!)
    || (has(r.fileName) && r.fileName!) || r.caption || r.fileName || r.content || "";
}

/** 「活跃日打点」：可搜索消息（convSeq>0、非撤回/系统）的本机时区日集合，key=`YYYY-M-D`（M 为 0 基，同日历判据）。 */
export function activeDayKeys(msgs: { timestamp: number; convSeq: number; recalledAt?: number; contentType?: string }[]): Set<string> {
  const s = new Set<string>();
  for (const m of msgs) {
    if (m.convSeq <= 0 || m.recalledAt || m.contentType === "system") continue;
    const d = new Date(m.timestamp);
    s.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  return s;
}
