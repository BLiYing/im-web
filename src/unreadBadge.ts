// 未读角标的显示格式（docs/design/OFFLINE_BACKLOG_DESIGN.md §6.1 U1）。
//
// 照搬 Telegram 的三档（`TelegramPresentationData` 的 `compactNumericCountString`）：
// <1000 原样、≥1000 显示 `1.2K`、≥100 万显示 `1.2M`。**它没有上限、没有 `+`**——
// 我们此前一律 `99+`，那个帽子其实来自服务端"扫 999 条再数"的成本，不是产品口径。
// 服务端换成覆盖索引计数后上限抬到万级，于是这里能报真数了。
//
// 与 Telegram 唯一的不同：我们仍有一个服务端上限，撞上了才补 `+`（如 `10K+`）。
// 那个 `+` 是**诚实**——它说的是"至少这么多"，而不是把 342 谎报成 99+。

/** 数值紧凑化：1234 → "1.2K"，5000 → "5K"，1200000 → "1.2M"。 */
export function compactCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const v = Math.floor(n);
  if (v >= 1_000_000) {
    const rem = Math.floor((v % 1_000_000) / 100_000);
    return rem !== 0 ? `${Math.floor(v / 1_000_000)}.${rem}M` : `${Math.floor(v / 1_000_000)}M`;
  }
  if (v >= 1000) {
    const rem = Math.floor((v % 1000) / 100);
    return rem !== 0 ? `${Math.floor(v / 1000)}.${rem}K` : `${Math.floor(v / 1000)}K`;
  }
  return String(v);
}

/**
 * 未读角标文案。capped=true 表示服务端计数撞到了上限（真实值 ≥ n），补一个 `+`。
 * n ≤ 0 返回空串，调用方据此不渲染角标。
 */
export function unreadBadgeText(n: number, capped = false): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return compactCount(n) + (capped ? "+" : "");
}
