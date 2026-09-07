// 相册批次口径（M4+，PROTOCOL §4.3 `group_id`）：一次选中的媒体如何成为**一个宫格**——
// 上限、group_id 生成、超限提示。纯函数，`useMediaSend#sendMediaBatch` 与单测共用。
//
// 三端同一口径：同一批发出的 ≥2 个图/视频**每个仍是独立消息**（可单独撤回/引用/转发），
// 只是共享一个客户端生成的 `group_id`，收端按它聚簇成 Telegram 式宫格；1 个不带（普通媒体气泡）。
//
// ⚠️ **发送侧 group_id 只有这一份**：附件选择器（onFilePicked）与粘贴攒批（App#send）
// 都汇到 `sendMediaBatch`，由它调本模块。别在调用侧再拼一次 `alb-` 前缀——两份迟早分叉
// （见 ../IMServer/docs/SYMMETRY.md 「一条路改对了、对称兄弟没跟」）。
import { albumRowPattern } from "./album";

/**
 * 一批最多几件。**三端同值 9**：
 * - iOS   `IMMediaPicker` 的 `cfg.selectionLimit = 9`（IMChatViewController+Media.m:360）
 * - Android `MediaPick.LIMIT = 9`、渲染侧 `AlbumLayout.MAX = 9`（ChatScreen 用 `take(MAX)`）
 * - Web   本常量；渲染侧 `album.ts#albumRowPattern` 也只排到 9
 *
 * 上限不是"美观偏好"而是**渲染契约**：`albumRowPattern(n>9)` 回 `[3,3,3]` 只有 9 格，
 * `AlbumGrid` 按行 `slice` 取数 → 第 10 件起**在宫格里根本不出现**。所以发送侧不截断的话，
 * 多出来的消息会真的发出去（对端数据库里有）却在两端都看不见——比"发不出去"更难查。
 */
export const ALBUM_MAX = 9;

/** group_id 前缀，与 iOS/Android 一致（日志里一眼认出这是相册，而非转发/收藏来的媒体）。 */
export const ALBUM_GROUP_ID_PREFIX = "alb-";

export interface AlbumBatchPlan<T> {
  /** 实际发出的一批：**保持用户选择顺序**，至多 ALBUM_MAX 件。 */
  batch: T[];
  /** 超限被丢下的件数（>0 必须提示用户，不能静默丢弃）。 */
  dropped: number;
  /** 这一批的相册标识：≥2 件才有（1 件是普通媒体气泡，不带）。 */
  groupId: string | undefined;
}

/**
 * 排一批媒体的发送计划。
 *
 * - `opts.groupId` 显式给定时**一律沿用**（重试单个失败成员要回到原来那个宫格里，
 *   哪怕这次只有 1 件——此时按"1 件不带 group_id"重算会让它掉出宫格变成一条独立气泡）。
 * - 否则 ≥2 件才新生成，1 件不带。
 * - 截断取**前** ALBUM_MAX 件：用户按顺序选，先选的优先级更高；也与"丢的是后面 N 个"的提示文案一致。
 */
export function planAlbumBatch<T>(
  items: readonly T[],
  opts: { groupId?: string; newId: () => string },
): AlbumBatchPlan<T> {
  const batch = items.slice(0, ALBUM_MAX);
  return {
    batch,
    dropped: items.length - batch.length,
    groupId: opts.groupId ?? (batch.length > 1 ? `${ALBUM_GROUP_ID_PREFIX}${opts.newId()}` : undefined),
  };
}

/** 超限提示文案；未超限回 null（调用方据此决定要不要 toast）。措辞与 Android「最多选 9 个」同调。 */
export function albumOverflowToast(dropped: number): string | null {
  return dropped > 0 ? `一次最多发送 ${ALBUM_MAX} 个，已忽略后面的 ${dropped} 个` : null;
}

/**
 * 上限与渲染排布是否自洽：`albumRowPattern(ALBUM_MAX)` 的格子数必须正好等于 ALBUM_MAX。
 * 只给测试用——把"改了 ALBUM_MAX 却没改 rowPattern（或反过来）"这件事变成一条会红的断言，
 * 而不是发出去以后才发现第 10 张不见了。
 */
export const albumGridCapacity = (): number => albumRowPattern(ALBUM_MAX).reduce((a, b) => a + b, 0);
