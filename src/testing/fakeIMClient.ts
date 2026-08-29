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
  async fetchConversations(): Promise<Conversation[]> { return FakeIMClient.conversations; }
  syncTracked() {}
  async listFriends() { return []; }
  async fetchMyProfile() { return { nickname: "我自己", phone: "", avatar_url: "" }; }
  async downloadSettings() { return { version: 1, settings: {} }; }
  // —— 会话/消息链路 ——
  async loadLocal(): Promise<ChatMessage[]> { return []; }
  async loadDeletedSeqs(): Promise<number[]> { return []; }
  async loadSyncCursor(): Promise<number> { return 0; }
  openConversation(...a: unknown[]) { this.rec("openConversation", ...a); }
  trackConversation() {}
  watchUsers(...a: unknown[]) { this.rec("watchUsers", ...a); }
  markRead(...a: unknown[]) { this.rec("markRead", ...a); }
  sendTyping() {}
  loadOlder() {}
  loadNewer() {}
  async fetchUserPresence() { return { onlineUntil: 0, lastSeen: 0 }; }
  async fetchPinned() { this.rec("fetchPinned"); return FakeIMClient.pinned; }
  sendText(content: string, to: string, convId: string): string {
    this.rec("sendText", content, to, convId);
    return `cmid-${++this.seq}`;
  }
}

/** 测试通过 `(IMClient as unknown as Fake).last` 驱动服务端事件 / 断言调用。 */
export type Fake = {
  last: { handlers: Record<string, (...a: unknown[]) => void>; calls: Record<string, unknown[][]> } | null;
  conversations: Conversation[];
  pinned: PinnedMessage[];
};

/** hook 测试：把部分实现的假客户端包成 clientRef。 */
export function fakeClientRef(client: Record<string, unknown>): MutableRefObject<IMClient | null> {
  return { current: client as unknown as IMClient };
}
