// 已弹出的系统通知登记表：让「撤回 / 别处已读 / 窗口回到前台」能把对应的通知收回去
// （与 iOS `IMPushRetract`、Android `FcmNotifications.rewrite/clearAll` 同口径）。
//
// **纯逻辑，不 import electron**——登记的只是「有 close() 的东西」，测试里给假对象就能跑。
//
// 顺带一个副作用是**必须的**：Electron 的 `Notification` 对象若没有任何引用会被 GC，
// 之后用户再点那条通知，`click` 回调就不会触发（「点通知打开会话」静默失效）。登记表持有引用，
// 正好把它们留住；上限之外的最旧那条只是放手（不主动关），交给系统自己的通知中心去管。

export interface Closable {
  close(): void;
}

/** 收哪些通知。**不带 convId = 全部**；带 convId 时 `convSeqs`（精确几条）优先于 `upTo`（≤ 该位点），都不带 = 该会话全部。 */
export interface NotifyScope {
  convId?: string;
  convSeqs?: number[];
  upTo?: number;
}

interface Entry {
  convId?: string;
  convSeq?: number;
  n: Closable;
}

function matches(e: Entry, s: NotifyScope): boolean {
  if (!s.convId) return true;
  if (e.convId !== s.convId) return false;
  if (s.convSeqs) return e.convSeq !== undefined && s.convSeqs.includes(e.convSeq);
  if (s.upTo !== undefined) return e.convSeq !== undefined && e.convSeq <= s.upTo;
  return true;
}

/** IPC 进来的参数是 unknown：形状不对就返回 null，**页面永远请求不到「全部」**（全清只有主进程自己在窗口
 *  回到前台时做）——认不准就不收，免得一个畸形请求把用户所有通知都清掉。 */
export function parseNotifyScope(p: unknown): NotifyScope | null {
  if (!p || typeof p !== "object") return null;
  const q = p as Record<string, unknown>;
  if (typeof q.convId !== "string" || !q.convId) return null;
  const scope: NotifyScope = { convId: q.convId };
  if (Array.isArray(q.convSeqs)) {
    const seqs = q.convSeqs.filter((x): x is number => typeof x === "number" && x > 0);
    if (seqs.length === 0) return null;
    scope.convSeqs = seqs;
  } else if (typeof q.upTo === "number") {
    if (!(q.upTo > 0)) return null;
    scope.upTo = q.upTo;
  }
  return scope;
}

export interface NotifyRegistry {
  add(convId: string | undefined, convSeq: number | undefined, n: Closable): void;
  /** 通知自己没了（用户划掉 / 点开）：只放手，不再 close。 */
  forget(n: Closable): void;
  /** 关掉命中的通知，返回关了几条。 */
  clear(scope: NotifyScope): number;
  size(): number;
}

export function createNotifyRegistry(max = 200): NotifyRegistry {
  let entries: Entry[] = [];
  return {
    add(convId, convSeq, n) {
      entries.push({ convId, convSeq, n });
      if (entries.length > max) entries = entries.slice(entries.length - max);
    },
    forget(n) {
      entries = entries.filter((e) => e.n !== n);
    },
    clear(scope) {
      const hit = entries.filter((e) => matches(e, scope));
      if (hit.length === 0) return 0;
      entries = entries.filter((e) => !matches(e, scope));
      for (const e of hit) {
        try { e.n.close(); } catch { /* 已被系统收走：没什么可做的 */ }
      }
      return hit.length;
    },
    size: () => entries.length,
  };
}
