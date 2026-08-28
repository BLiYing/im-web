// listSearch：列表页「搜一下」的统一匹配口径（纯函数，无 React）。
//
// 为什么单开一个文件：转发选择、邀请成员、建群选好友、@提及面板都要"按显示名/uid 收窄列表"。
// 各写各的 `.toLowerCase().includes()` 会漂移成四套——有的匹配 uid 有的不匹配、有的忘了 trim。
//
// 口径：大小写不敏感子串，命中任一字段即算命中；查询词两端空白先裁掉；空查询恒命中
// （调用方据此可以不写分支）。拼音首字母匹配需额外索引，本期不做——中文直接键入汉字即可命中。
//
// 隐私提醒：好友备注可以作为匹配字段传进来（搜索是纯本地的），但备注**不能**因此进入任何
// 会发出去的内容，见 ../IMServer/docs/UI.md「备注 · 隐私红线」。

/** 规整查询词（裁两端空白 + 转小写）。返回空串表示"没有在搜"。 */
export function normalizeQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/** fields 里任一字段包含 query（大小写不敏感）即命中。空 query 恒 true；nil/空字段自动跳过。 */
export function matchesQuery(query: string | null | undefined, fields: (string | null | undefined)[]): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  return fields.some((f) => !!f && f.toLowerCase().includes(q));
}

/** 按 query 过滤列表；fieldsOf 给出每项参与匹配的字段。空 query 原样返回（不复制数组）。 */
export function filterByQuery<T>(
  items: T[],
  query: string | null | undefined,
  fieldsOf: (item: T) => (string | null | undefined)[],
): T[] {
  const q = normalizeQuery(query);
  if (!q) return items;
  return items.filter((item) => matchesQuery(q, fieldsOf(item)));
}
