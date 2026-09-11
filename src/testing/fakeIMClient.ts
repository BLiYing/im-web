// 测试共享：mock ./sdk/imSdk 的 FakeIMClient（Proxy 兜底未显式实现的方法 → async undefined 并记录调用）与
// hook 测试用的 fakeClientRef。App.smoke / App.messageList 两套 App 级测试与各 use*.test 共用，不再各自复制一份。
// 用法：`vi.mock("./sdk/imSdk", async () => ({ IMClient: (await import("./testing/fakeIMClient")).FakeIMClient, registerAccount: vi.fn(async () => {}) }));`
import type { MutableRefObject } from "react";
import type { IMClient } from "../sdk/imSdk";
import type { Conversation, ChatMessage, PinnedMessage } from "../sdk/protocol";

type Handlers = Record<string, ((...a: unknown[]) => void) | undefined>;

export class FakeIMClient {
  static last: FakeIMClient | null = null;
  static conversations: Conversation[] = [];
  /** 区间清单（"本地有哪几段"）。取数分流与渲染切段都读它，故用例要能摆布它。 */
  static ranges: { lo: number; hi: number }[] = [];
  static head = 0;
  static floor = 0;   // 服务端说过的可见下界位点（0=未知）
  static pinned: PinnedMessage[] = []; // 置顶集合（G0 横幅数据源）：测试可就地改，模拟服务端剔除撤回/取消置顶
  handlers: Handlers;
  calls: Record<string, unknown[][]> = {}; // 方法名 → 各次调用实参（断言用）
  private seq = 0;
  constructor(handlers: Handlers = {}) {
    this.handlers = handlers;
    FakeIMClient.last = this;
    // 未显式实现的方法一律 async no-op（记录调用），避免逐一枚举 40+ 个 SDK 方法。
    return new Proxy(this, {
      get: (t, p, r) => {
        if (p in t) return Reflect.get(t, p, r);
        const fn = async (...a: unknown[]) => { (t.calls[String(p)] ??= []).push(a); return undefined; };
        Reflect.set(t, p, fn);
        return fn;
      },
    });
  }
  private rec(name: string, ...a: unknown[]) { (this.calls[name] ??= []).push(a); }
  // —— 启动链路 ——
  // 真实 SDK 的 connect 入参是 **username**，内部 ID 由 /login 响应带回并落到 userId 上。
  // Fake 照搬这个语义：connect(username) 之后 userId 变成 FakeIMClient.internalUID，
  // 否则测试会在「username 当内部 ID 用」的错误前提下全绿。
  static internalUID = "1000001001";
  private _uid = "";
  get userId(): string { return this._uid; }
  async connect(username: string, pwd: string) { this.rec("connect", username, pwd); this._uid = FakeIMClient.internalUID; }
  async connectWithToken(uid: string, token: string) { this.rec("connectWithToken", uid, token); this._uid = uid; }
  disconnect() { this.rec("disconnect"); }
  cachedConversations(): Conversation[] { return []; }
  cacheConversations() {}
  // 这三条记录调用：会话刷新的接线测试要数「刷新了几次 / 重读了哪些会话 / 同步了哪些会话」。
  async fetchConversations(): Promise<Conversation[]> { this.rec("fetchConversations"); return FakeIMClient.conversations; }
  syncTracked(...a: unknown[]) { this.rec("syncTracked", ...a); }
  async listFriends() { return []; }
  async fetchMyProfile() { return { nickname: "我自己", phone: "", avatar_url: "" }; }
  async downloadSettings() { return { version: 1, settings: {} }; }
  // —— 会话/消息链路 ——
  async loadLocal(...a: unknown[]): Promise<ChatMessage[]> { this.rec("loadLocal", ...a); return []; }
  async loadDeletedSeqs(): Promise<number[]> { return []; }
  async loadSyncCursor(): Promise<number> { return 0; }
  openConversation(...a: unknown[]) { this.rec("openConversation", ...a); }
  jumpToLatest(...a: unknown[]): boolean { this.rec("jumpToLatest", ...a); return true; }
  catchUpOnBump(...a: unknown[]): boolean { this.rec("catchUpOnBump", ...a); return false; }
  trackConversation() {}
  watchUsers(...a: unknown[]) { this.rec("watchUsers", ...a); }
  markRead(...a: unknown[]) { this.rec("markRead", ...a); }
  sendTyping() {}
  // 同步取值的方法必须显式实现：Proxy 兜底回的是 Promise（恒真），会让 UI 把"本地有缺口"当成常态、
  // 把 head 当成一个对象。
  hasGap(): boolean { return false; }
  // 同上：渲染切段要读区间清单（"这两条中间缺的号是没下载、还是本就不成为消息"）。
  // Proxy 兜底回 Promise，会被 visibleSlice 当成一个没有 length 的清单。
  rangesOf(): { lo: number; hi: number }[] { return FakeIMClient.ranges; }
  headOf(): number { return FakeIMClient.head; }
  /** 上沿是否已踩在服务端说过的可见下界上。**位点语义**：从旧岛记下的下界不该屏蔽新段的上滑。 */
  atHistoryFloor(_convId: string, oldestSeq: number): boolean {
    return FakeIMClient.floor > 0 && oldestSeq <= FakeIMClient.floor;
  }
  loadOlder(...a: unknown[]) { this.rec("loadOlder", ...a); }
  loadNewer(...a: unknown[]) { this.rec("loadNewer", ...a); }
  async fetchUserPresence() { return { onlineUntil: 0, lastSeen: 0 }; }
  async fetchPinned() { this.rec("fetchPinned"); return FakeIMClient.pinned; }
  sendText(content: string, to: string, convId: string): string {
    this.rec("sendText", content, to, convId);
    return `cmid-${++this.seq}`;
  }
  // 失败重发走 sdk/resend.ts 的自由函数 → 最终仍落到 sendMedia；显式实现它以返回真实的
  // string cid（Proxy 兜底会返回 Promise），并记录实参供断言"沿用了原 clientMsgId"。
  sendMedia(content: string, contentType: string, to: string, convId: string, opts?: Record<string, unknown>): string {
    this.rec("sendMedia", content, contentType, to, convId, opts);
    return (opts?.clientMsgId as string) ?? `cmid-${++this.seq}`;
  }
}

/** 测试通过 `(IMClient as unknown as Fake).last` 驱动服务端事件 / 断言调用。 */
export type Fake = {
  last: { handlers: Record<string, (...a: unknown[]) => void>; calls: Record<string, unknown[][]> } | null;
  conversations: Conversation[];
  pinned: PinnedMessage[];
  ranges: { lo: number; hi: number }[];
  head: number;
  floor: number;
};

/** hook 测试：把部分实现的假客户端包成 clientRef。 */
export function fakeClientRef(client: Record<string, unknown>): MutableRefObject<IMClient | null> {
  return { current: client as unknown as IMClient };
}
