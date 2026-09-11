// 深链（D4 收尾）：`imdesktop://q/u/<token>` / `imdesktop://q/g/<token>` 打开对应的邀请码。
//
// **只收邀请码两种，其余一律丢**。深链是**任何网页都能触发**的入口（页面里一句
// `location = "imdesktop://…"`，浏览器问一句「要打开 IM Desktop 吗」就过来了），
// 所以它能做的事必须是「点聊天里一条邀请链接」能做的事的子集：
//   · 名片码 / 群码 → 页面走服务端 resolve → 结果卡片，**要用户再点一次**才会加好友 / 进群；
//   · **登录码 q/l 刻意不收**——那是 QRLjacking 的钓鱼面，与 im-web `qr.ts#isOwnInviteLink`
//     在聊天里拦截链接时排除 /q/l 是同一个理由。
//
// 链接怎么进来（三条路，平台各不相同）：
//   · macOS：`open-url` 事件（冷启动时它**早于 ready** 到，所以监听必须在 index.ts 模块顶层装）；
//   · Windows / Linux 冷启动：链接在 `process.argv` 里；
//   · Windows / Linux 已在运行：第二个进程被单实例锁拒掉，链接跟着 `second-instance` 的 argv 过来。
//
// **排队，而不是直接推给页面**：冷启动时页面还没加载、用户可能还没登录，推过去没人接就丢了。
// 主进程只攒着并发一个「有新链接」的信号；页面登录后订阅时自己来取（drain），取走即清。
// 主进程是单线程，取是原子的——既不会丢，也不会同一条被处理两次。

export const DEEP_LINK_SCHEME = "imdesktop";
/** 主 → 页面：有新链接了，来取。preload 那侧是同名字面量（preload 不许 import，见其顶部）。 */
export const IPC_DEEP_LINK_AVAILABLE = "im:deep-link-available";
/** 页面 → 主：取走全部排队的链接。同上。 */
export const IPC_DEEP_LINK_DRAIN = "im:deep-link-drain";

/** 排队上限。深链是人点出来的，攒到这么多只可能是被刷——多的丢最旧的，别让队列无界长。 */
export const MAX_PENDING = 8;

/** token 是服务端 base62（IMServer `internal/qrcode` 的 genToken，当前 22 位）。
 *  上限放宽到 64 给将来加长留余地，但字符集卡死——`../`、`%2F` 这类一律不认。 */
const LINK_RE = /^imdesktop:\/\/q\/([ug])\/([A-Za-z0-9]{1,64})\/?(?:[?#].*)?$/i;
/** 「看起来是本应用的深链」：用来区分「认不出的深链（要记一笔）」和「普通启动参数（别吵）」。 */
const SCHEME_RE = /^imdesktop:/i;

/** 把一条深链解析成页面能直接交给 `handleScanRaw` 的扫码原文（`q/g/<token>`）；不认识返回 null。 */
export function parseDeepLink(url: string): string | null {
  const m = LINK_RE.exec(url.trim());
  // kind 归一成小写：正则带 i，而服务端 parseRaw 只认小写的 u/g。token 区分大小写，原样保留。
  return m ? `q/${m[1].toLowerCase()}/${m[2]}` : null;
}

/** 排队的深链：去重（系统偶尔重复投递、用户双击）、有界、取走即清。 */
export class DeepLinkQueue {
  private pending: string[] = [];

  constructor(private readonly max = MAX_PENDING) {}

  /** 收一条已解析的原文；返回是否真的入队（已在队里的不再入）。 */
  push(raw: string): boolean {
    if (this.pending.includes(raw)) return false;
    this.pending.push(raw);
    if (this.pending.length > this.max) this.pending.splice(0, this.pending.length - this.max);
    return true;
  }

  drain(): string[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }
}

export interface DeepLinkRouter {
  /** 收一条 URL（macOS `open-url`）。返回是否认得。 */
  acceptUrl(url: string): boolean;
  /** 收一组启动参数（冷启动 argv / `second-instance`），返回认得几条。普通参数静默跳过。 */
  acceptArgv(argv: readonly string[]): number;
  /** 页面来取。 */
  drain(): string[];
}

/**
 * @param notify  入队后调：让主进程给页面发「有新链接」的信号。页面还没起来时它什么都不做即可——
 *                链接留在队里，页面订阅时会先取一次。
 * @param onReject 认不出的本应用深链（如登录码）记一笔。**不传 URL 原文**：里面可能带着 token。
 */
export function createDeepLinkRouter(
  notify: () => void,
  onReject: (reason: string) => void,
  queue = new DeepLinkQueue(),
): DeepLinkRouter {
  const accept = (url: string): boolean => {
    const raw = parseDeepLink(url);
    if (!raw) {
      onReject(`不认识的深链（${url.length} 字符）——只收 q/u 与 q/g，登录码 q/l 刻意不收`);
      return false;
    }
    if (queue.push(raw)) notify();
    return true;
  };
  return {
    acceptUrl: accept,
    acceptArgv: (argv) => argv.filter((a) => SCHEME_RE.test(a)).filter(accept).length,
    drain: () => queue.drain(),
  };
}
