// 本地消息库的**能力契约**（D4-3a）。方案见 IMServer 的 docs/design/DESKTOP_DESIGN.md §7.6。
//
// 存在的理由：浏览器版只能用 IndexedDB，桌面版要换 SQLite（原生模块只能落主进程，页面经桥调用）。
// 把这张面收进一个接口，`sdk/localStore*.ts` 之外的代码就完全不需要知道消息落在哪。
//
// 三条硬规矩（与 `src/platform/types.ts` 同源，`docs/SYMMETRY.md` 已就 `src/sdk/localStore*.ts` 登记）：
//   ① **选择实现只有一处**：`localStore.ts` 里的 `pickStore()`。别在业务代码里问「我是不是桌面端」。
//   ② **web 与 desktop 是双实现**：接口加一个方法就要两侧都补，`localStore.contract.test.ts`
//      对两套实现跑同一组断言。要对称的是「同一能力在两端语义一致」，不是「两份代码长得一样」。
//   ③ **失败只降级，绝不抛**：持久化是增强。写失败记 `IM.STORE` warn 后照常返回；读失败返回空值
//      （`[]` / `0` / `{ranges:[],head:0}`）。任何一个方法把异常抛到调用方，都会让收发主流程跟着断。
//
// **不在本接口里（刻意）**：
// - **会话列表缓存**（`saveConversations` / `loadConversations`）：它是 `localStorage` 里的单个 JSON
//   blob，而 `localStorage` 在 Electron 渲染进程里原样可用（`src/platform/types.ts` 那句
//   「65 处 localStorage 绝大多数不用动」同样适用）。而且它俩是**同步**的——调用方就地取值，
//   收进这张全异步的面等于为了整齐去改一批与桌面端无关的调用点。它继续留在 `localStore.web.ts`。
// - **`openDB` / object store 名 / 复合键的建表**：那是 IndexedDB 的实现细节，SQLite 侧没有对应物。
//   唯一跨实现的是**记录键的形状**（见下面 `keyOf` / `cursorKeyOf`），因为它可观测。

import type { ChatMessage, MsgOpPatch, SysSegment } from "./protocol";
import type { SeqRange } from "./ranges";
import type { MentionSpan } from "../mention";

/**
 * 一条落库的消息。**字段少一个就是刷新后少一样东西**——下面每个可选字段的注释都记着它曾经
 * 怎么丢的，SQLite 实现建列时逐条对着看（IndexedDB 存整个对象所以「不会漏」，换成逐列存储
 * 就会漏，`localStore.contract.test.ts` 的「字段整轮往返」用例守的就是这条）。
 */
export interface MsgRecord {
  /**
   * 记录唯一键。已确认：`owner|convId|convSeq`；被拒(convSeq=0)：`owner|convId|c:clientMsgId`。
   * **形状是契约的一部分**（不是实现细节）：删除墓碑按同一个键落，`loadDeletedSeqs` 反过来从键里
   * 解出 conv_seq，`loadConversation` 在没有 `serverMsgId` 的老记录上还会把它当 id 回退出去。
   * 一律用 `keyOf()` 拼，别在实现里另写一遍。
   */
  id: string;
  owner: string;
  convId: string;
  convSeq: number;
  from: string;
  // 发送者昵称/角色快照（服务端随群消息冗余下发）。**必须持久化**：
  // 普通群里丢了还能从群成员表兜底，看不出来；超级群资料只下发"我自己"（语义降级⑤），
  // 兜底失效——刷新后整个会话的发件人全部显示「未命名用户」（2026-09-01 大群联测实锤）。
  fromNickname?: string;
  fromRole?: string;
  content: string;
  contentType: string;
  fileName?: string;
  fileSize?: number;
  caption?: string; // 图文/视频文/文件文随附文本（Telegram 图说模型）：仅 image/video/file 有
  mentions?: string[]; // M4-8 被 @ 成员 uid：刷新后 caption/正文 @ 高亮可点 + 转发重发（强提醒）都靠它
  mentionSpans?: MentionSpan[]; // @ token 的位置（UTF-16 偏移）：不落库的话刷新后大群里的 @ 又会退回不高亮
  mentionAll?: boolean; // @所有人
  // 系统消息分段：必须落库，否则刷新后系统消息退回"显真实昵称、名字不可点"，与刚收到时不一致。
  sysSegments?: SysSegment[];
  // P3：系统消息/通知的结构化事件+参数、引用快照的结构化种类+参数。必须落库，否则刷新后本地化
  // 渲染退回老的整句 content/replySnapshot（不是崩，但语言会锁死成服务端当时生成的那版）。
  sysEvent?: string;
  sysArgs?: Record<string, string>;
  replySnapshotKind?: string;
  replySnapshotArgs?: Record<string, string>;
  timestamp: number;
  serverMsgId?: string; // 服务端真实消息 id（举报消息等需用真实 id，不能用复合键 id）
  // 被拉黑拒收等失败消息：服务端永不接受（无 conv_seq），故按本地态落库，重进/刷新仍在。
  clientMsgId?: string;
  status?: "failed";  // 仅落"被拒"失败态；已确认消息不写此字段（读回默认 received）
  note?: string;      // 系统提示文案（如"消息已发出，但被对方拒收了"）
  // M4 消息操作派生状态（撤回/编辑/置顶）：由 applyMsgOpLocal 就地更新，读回还原到 ChatMessage。
  recalledAt?: number;
  recalledBy?: string;
  editedAt?: number;
  pinnedAt?: number;
  replyToConvSeq?: number;
  replySnapshot?: string;
  replyToFrom?: string;
  forwardFrom?: string;
  groupId?: string; // 相册分组（M4+）
  posterUrl?: string; // 视频封面首帧 URL（M4+）
  mediaW?: number;    // 媒体像素宽（M4+）：按原比例渲染气泡，免加载完跳版
  mediaH?: number;    // 媒体像素高（M4+）
  duration?: number;  // 视频时长毫秒（M4+）：封面左上角角标
  thumb?: string;     // 极小模糊预览 data URI（M4-7）：未下载卡片的磨砂占位。**必须持久化**，否则刷新后门控图退化成中性斜纹底
  // voice 振幅指纹（base64）：收端不下载音频就能画气泡波形。
  // **2026-09-09 补**：它是后端下行结构（`protocol.MessageView`）里唯一一个本地没落库的字段——
  // `parseMessage` 解出来了、落库这一步丢掉，于是刷新后语音气泡的波形退化成等高条纹，
  // 且 `resend.ts` 重发失败语音时也带不回。空=退化等高条纹（老记录仍是这个样子）。
  waveform?: string;
}

/** 「本地有哪几段」目录的一次读取结果（OFFLINE_BACKLOG_DESIGN §4.2）。`head` 是服务端最新位点的最近快照。 */
export interface RangesSnapshot {
  ranges: SeqRange[];
  head: number;
}

/** 删除目标：已确认消息给 `convSeq`，被拒消息（convSeq=0）给 `clientMsgId`。两个都没有则整体忽略。 */
export interface DeleteTarget {
  convSeq?: number;
  clientMsgId?: string;
}

/** 搜索入参。`convId` 缺省 = 全局搜索（扫全部会话）。 */
export interface SearchOptions {
  convId?: string;
  q: string;
  limit: number;
}

/**
 * 稀疏重放的合并规则——**两侧实现共用这一份，别各写各的**。
 *
 * 同一条消息可能先由 ACK/实时帧落库、后由 sync_resp 再次到达，后到的那份字段更少。
 * 下面这 5 个字段**不许被稀疏负载覆盖**（每个都对应过一次真实事故，最贵的是昵称那条：
 * 超级群资料只下发本人，抹掉后整个会话的发件人变「未命名用户」）；其余字段以最后一次
 * 写入为准。
 *
 * 抽成共用函数不是为了省行数，是因为它**没法靠断言盯住**：白名单里少一个字段、或者
 * SQLite 侧把它翻译成 SQL 时 `NULLIF`/`COALESCE` 写反，表现都是「刷新后某样东西没了」。
 * 让两侧跑同一份代码，这类分叉在结构上就不可能发生。
 */
export function mergeRecords<T extends MsgRecord>(existing: T | undefined, rec: T): T {
  return {
    ...existing,
    ...rec,
    fileName: rec.fileName || existing?.fileName,
    fromNickname: rec.fromNickname || existing?.fromNickname,
    fromRole: rec.fromRole || existing?.fromRole,
    fileSize: rec.fileSize !== undefined && rec.fileSize > 0 ? rec.fileSize : existing?.fileSize ?? rec.fileSize,
    serverMsgId: rec.serverMsgId || existing?.serverMsgId,
  };
}

/**
 * 一条消息里**参与搜索命中的那几段文本**——同样是两侧共用的一份（与后端 G4 / iOS 对齐）。
 *
 * 规则：`content` **仅 text 消息**参与；`caption` 与 `fileName` 任意类型都参与。
 * 媒体/文件的 content 是 URL，**不参与**——否则搜索词撞上服务端生成的 URL 片段，
 * 会命中一条「看不见文字」的消息。
 *
 * web 侧拿它做内存子串比对；SQLite 侧拿它算出落库时的小写检索列（那样 `LIKE` 的判据
 * 与 JS 的 `toLowerCase().includes()` **逐字相同**——不能直接用 SQL 的 `lower()`，
 * 它只认 ASCII，`lower('Äpfel')` 原样返回，于是「ÄPFEL」搜不到「äpfel」而且不报错）。
 * 撤回不参与命中，那是**状态**判断、不在本函数里（见各实现的 WHERE / 过滤）。
 */
export function searchableFields(rec: Pick<MsgRecord, "content" | "contentType" | "caption" | "fileName">): {
  content: string; caption: string; fileName: string;
} {
  const isText = !rec.contentType || rec.contentType === "text";
  return {
    content: isText ? rec.content ?? "" : "",
    caption: rec.caption ?? "",
    fileName: rec.fileName ?? "",
  };
}

/** 消息记录键：已确认消息按 (owner, conv, conv_seq) 唯一，重复落库幂等覆盖。 */
export const keyOf = (owner: string, convId: string, convSeq: number) => `${owner}|${convId}|${convSeq}`;

/** 被拒消息（拿不到 conv_seq）的记录键：按 clientMsgId 唯一，与已确认消息的键不冲突。 */
export const rejectedKeyOf = (owner: string, convId: string, clientMsgId: string) =>
  `${owner}|${convId}|c:${clientMsgId}`;

/** 每会话一行的记录键（连续游标、区间目录共用）。 */
export const cursorKeyOf = (owner: string, convId: string) => `${owner}|${convId}`;

/**
 * `LocalStore` 的全部方法名。**桥的白名单以它为准**（桌面端 D4-3b）。
 *
 * 放在契约文件里而不是代理文件里，是因为它得能被 `desktop/` 那个独立工程 import——
 * 本文件只有 `import type`，跨过去不会带进任何浏览器侧运行时代码（§7.4）。
 *
 * 下面那行 `_MethodsAreExhaustive` 是**编译期护栏**：给 `LocalStore` 加了方法却忘了加进
 * 这份清单，`tsc` 当场报错。没有它的话，漏加的表现是「桌面端那一个方法静默不工作」——
 * 页面调它 → 主进程白名单不认 → 返回 undefined → 代理按兜底值处理，一路没有报错。
 */
export const LOCAL_STORE_METHODS = [
  "saveMessage", "saveIncomingMessage", "saveIncomingPage", "saveRejected",
  "applyMsgOpLocal", "markMessageDeleted", "clearMessages", "advanceSyncCursor",
  "registerRange", "updateRangesHead",
  "loadConversation", "loadDeletedSeqs", "loadSyncCursor", "loadRanges", "loadClearedUpTo", "searchMessages",
] as const;

export type LocalStoreMethod = (typeof LOCAL_STORE_METHODS)[number];

/** 编译期穷尽性检查：`LocalStore` 的方法必须与上面的清单一一对应，多一个少一个都报错。 */
type _MethodsAreExhaustive =
  [Exclude<Exclude<keyof LocalStore, "name">, LocalStoreMethod>] extends [never]
    ? [Exclude<LocalStoreMethod, Exclude<keyof LocalStore, "name">>] extends [never]
      ? true
      : { 错误: "清单里有 LocalStore 上不存在的方法" }
    : { 错误: "LocalStore 新增了方法，但没加进 LOCAL_STORE_METHODS" };
const _methodsCheck: _MethodsAreExhaustive = true;
void _methodsCheck;

/**
 * 本地消息库的能力面。**所有方法都异步**——IndexedDB 本来就是异步的，桌面端还要跨进程，
 * 签名上没有第二种选择。所有方法都**按 owner（本人 uid）隔离**：同一台机器多账号不许串库。
 */
export interface LocalStore {
  /** 实现标识，只用于日志与契约测试的用例名（如 `web-indexeddb` / `desktop-sqlite`）。 */
  readonly name: string;

  // ---- 写 ----

  /**
   * 保存一条已确认消息（convSeq>0）。发送中/普通失败的临时态不入库。
   *
   * **合并是白名单式的，别写成"全字段保值"**：同一条消息可能先由 ACK/实时帧落库、后由 sync_resp
   * 再次到达，后到的那份字段更少。只有 `fileName` / `fromNickname` / `fromRole` / `fileSize`（>0 才算）
   * / `serverMsgId` 这 5 个**不许被稀疏重放覆盖**（各自都对应过一次真实事故）；
   * 其余字段**以最后一次写入为准**——后到的稀疏负载会把 `thumb`/`caption`/`groupId`/`mentionSpans`
   * 等抹掉。这不是笔误，是现状；两侧实现必须一致，否则同一次重放 web 抹掉、desktop 留着，
   * 两端显示就此分叉（`localStore.contract.ts` 里正反两条断言都钉着）。
   */
  saveMessage(owner: string, m: ChatMessage): Promise<void>;

  /**
   * 收到一条消息的原子落库：消息与连续游标**同一个事务**。
   * 崩溃时要么都成功、要么游标停在旧位置下次幂等重拉，不会出现"游标已过、消息没落库"。
   */
  saveIncomingMessage(owner: string, m: ChatMessage, advanceCursor: boolean): Promise<void>;

  /**
   * **整页**补拉的原子落库（OFFLINE_BACKLOG_DESIGN §4.8）：一页消息 + 游标推进 + 区间登记同一个事务。
   * 返回是否成功——调用方据此决定要不要继续翻下一页。
   *
   * ⚠️ **桥上必须保留这个「整页写」原语**（DESKTOP_DESIGN §7.6.3）：桌面端若退化成逐条 IPC，
   * 一页 100 条就是 100 次跨进程往返，同步 10 万条时是 500 次事务与 10 万次事务的差别。
   *
   * `advanceTo`：本页权威覆盖位点（服务端 covered_conv_seq）；0 表示不推进。
   * `rangeFrom`/`rangeTo`：本页齐全的区间；`rangeTo < rangeFrom` 表示不登记。
   */
  saveIncomingPage(
    owner: string, msgs: ChatMessage[], advanceTo: number, rangeFrom: number, rangeTo: number, head?: number,
  ): Promise<boolean>;

  /** 保存一条被拒收的失败消息（被拉黑：服务端永不接受、无 conv_seq）。按 clientMsgId 落库，重进/刷新仍在。 */
  saveRejected(owner: string, m: ChatMessage): Promise<void>;

  /**
   * 把一次消息操作（撤回/编辑/置顶）就地应用到已落库消息。**记录不存在则忽略，不许新建行**
   * （撤回一条本地没有的消息不该凭空造出一条空消息）。`advanceCursorTo>0` 时顺带推进游标（同事务）。
   *
   * **改 content 必须连带清空 `mentionSpans`**：偏移是相对原文的，正文一改就全错位——留着的话，
   * 新正文碰巧在同一偏移有个 `@` 就会高亮出来，而且**点进去是另一个人**的资料页。
   */
  applyMsgOpLocal(
    owner: string, convId: string, convSeq: number, patch: MsgOpPatch, advanceCursorTo?: number,
  ): Promise<void>;

  /**
   * 本地删除一条消息（对齐 iOS「删除」——服务端无删消息接口，纯本地）：**落一条删除墓碑**并抹掉消息。
   * 墓碑令后续读取永久过滤掉它，故刷新 / 后台重同步重新落库也**不复现**。
   */
  markMessageDeleted(owner: string, convId: string, target: DeleteTarget): Promise<void>;

  /**
   * 清空某会话的本机消息（对齐 iOS「清空聊天记录」，仅清本地、不动服务端）。
   *
   * **本机清空位点 `clearedUpTo`**（OFFLINE_BACKLOG_DESIGN §6.7）：清空后若没有别的记号，区间清单又被清掉，
   * 进会话会看到「本地没有、服务端有」，老老实实把最近一页拉回来——刚清掉的内容就冒出来了。
   * 位点把「用户**主动**不要这一段」与「**还没**下载这一段」分开。**同一事务内**：
   *   1. 删本会话全部消息；
   *   2. 区间清单清成空（head 快照保留，且**必须落一行空清单**——没有行时 `loadRanges` 会由游标反推 `[1,cursor]`）；
   *   3. 位点 = `max(已有位点, knownLatest, 区间行的 head, 同步游标, 本地最大 conv_seq)`，**只增不减**；
   *   4. 同步游标推到不小于位点；
   *   5. **墓碑不动**（删掉墓碑会让重同步把单删过的消息复活）。
   * `knownLatest`：调用方知道的会话最新位点（会话列表 latest / 内存 head / 内存游标取大），本库不知道的那部分靠它补。
   *
   * 清空之后：`conv_seq <= 位点` 的消息在 `saveMessage` / `saveIncomingMessage` / `saveIncomingPage` 里一律丢弃
   * （区间登记与游标推进口径不变）；位点之后的新消息照常收。
   */
  clearMessages(owner: string, convId: string, knownLatest?: number): Promise<void>;

  /** 单调推进连续同步游标（只增不减）。写失败时下次从较低位置重拉，最多幂等重复，不会漏消息。 */
  advanceSyncCursor(owner: string, convId: string, convSeq: number): Promise<void>;

  /**
   * 登记一段"这段我已齐全"，可顺带更新 head 快照（取 max）。返回归一化后的新清单。
   *
   * **调用契约（§4.2 不变量 I1）**：只在这一段的消息**全部落库成功之后**才调用——区间断言的是
   * "这段我齐全"，提前登记等于宣称拿到了其实没拿到的消息，上层据此跳过补拉，那一段就永久漏了。
   */
  registerRange(owner: string, convId: string, lo: number, hi: number, head?: number): Promise<SeqRange[]>;

  /**
   * 只更新 head 快照（收到 too_long / conv_bump 时用：知道了服务端最新位点，但一条正文都没拿到）。
   * **绝不动 ranges**——那正是"没下载就不许登记"的体现。
   */
  updateRangesHead(owner: string, convId: string, head: number): Promise<void>;

  // ---- 读 ----

  /**
   * 读某会话的全部本地消息，**按 conv_seq 升序**，并过滤掉带墓碑的。
   * 被拒消息（convSeq=0）还原成 `status:"failed"` + `note`，媒体字段一并还原。
   */
  loadConversation(owner: string, convId: string): Promise<ChatMessage[]>;

  /**
   * 读某会话被本地删除的 conv_seq 列表：登录/进会话时载入内存，供 `onMessage` 挡住服务端重同步的**复现**。
   * `loadConversation` 只在读盘时过滤墓碑，而实时帧那条路径绕过读盘，故必须另有一份内存墓碑。
   * **只返回 conv_seq 型墓碑**（`c:clientMsgId` 型是被拒消息，服务端本就不会重推）。
   */
  loadDeletedSeqs(owner: string, convId: string): Promise<number[]>;

  /** 读连续同步游标。**无记录返回 0**——不从本地消息最大值推断（那会跳过中间没落库的段）。 */
  loadSyncCursor(owner: string, convId: string): Promise<number>;

  /**
   * 读「本地有哪几段」目录。**老库兼容**：没有 ranges 行时用连续游标反推出首段 `[1, cursor]`——
   * 不这么做的话老用户升级后会被判成"整个会话都是缺口"，本地搜索一夜之间全改走服务端。
   */
  loadRanges(owner: string, convId: string): Promise<RangesSnapshot>;

  /**
   * 读本机清空位点（无记录 = 0）。**纯本机状态**：服务端快照、会话列表刷新、重登都不会、也不许把它重置；
   * 有效可见下界 = `max(服务端 has_before=false 记下的 floorSeq, 本位点)`，两者各存各的、用时取大。
   * **老库回填**（升级前清空过的会话没有任何痕迹）：对游标>0 的会话，位点 = 游标以内最小本地消息 seq − 1；
   * 游标以内本地一条没有则 = 游标。判据见 `clearFloor.ts#backfillClearedUpTo`。
   */
  loadClearedUpTo(owner: string, convId: string): Promise<number>;

  /**
   * 本地消息搜索（纯本地，SEARCH_DESIGN §7.2）。给 `convId` = 会话内，不给 = 全局。
   *
   * **命中判据是跨端契约，不许各实现自己发挥**（`docs/SYMMETRY.md` 明写「搜索命中判据一致」）：
   * `content`（**仅 text 消息**）/ `caption` / `fileName` 的**大小写不敏感子串**。
   * 媒体/文件的 content 是 URL，**不参与**——否则搜索词撞上 URL 片段会命中"看不见文字"的消息。
   * 撤回（`recalledAt`）不参与命中，墓碑消息过滤掉。
   *
   * ⚠️ **这条判据是 SQLite 侧不上 FTS5 的原因**（DESKTOP_DESIGN §7.6.1）：FTS5 的 trigram 分词器
   * 要 ≥3 字符，而中文搜索绝大多数是两个字（「开会」搜不到），且它**静默失效**。SQLite 实现用
   * `LIKE`（10 万条实测 ~80 ms，用户分辨不出），判据逐字不变。
   *
   * 结果**按时间倒序**（新→旧，tiebreak `convSeq` 倒序），上限 `limit`。
   */
  searchMessages(owner: string, opts: SearchOptions): Promise<MsgRecord[]>;
}
