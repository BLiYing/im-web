// conv_bump 帧（超级群轻量投递信号）的解析。
//
// 单独成模块是为了让「脏 payload 怎么处理」有地方写清楚、也能单测：
// 帧来自网络，items 可能缺字段、类型不对、甚至不是数组。解析层一律**丢弃坏条目而不抛**——
// 一条坏信号不该让整帧（乃至整条连接的分发循环）挂掉。
//
// 语义见 IMServer/docs/design/SUPERGROUP_DESIGN.md §5。

import type { ConvBumpItem } from "./protocol";

/** 从 conv_bump 的 data 里解出有效信号条目；非法条目静默丢弃。 */
export function parseConvBumpItems(data: unknown): ConvBumpItem[] {
  const raw = (data as { items?: unknown })?.items;
  if (!Array.isArray(raw)) return [];
  const out: ConvBumpItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const convId = typeof o.conv_id === "string" ? o.conv_id : "";
    // latest_seq 缺失/非数值时按 0 处理：调用方会与本地位点比较，0 表示"不用拉"。
    const latestSeq = typeof o.latest_seq === "number" ? o.latest_seq : 0;
    if (!convId) continue;
    out.push({
      conv_id: convId,
      latest_seq: latestSeq,
      from: typeof o.from === "string" ? o.from : undefined,
      from_nickname: typeof o.from_nickname === "string" ? o.from_nickname : undefined,
      preview: typeof o.preview === "string" ? o.preview : undefined,
    });
  }
  return out;
}
