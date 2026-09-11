// 深链的判据。**这组是安全判据，不是格式校验**：深链是任何网页都能触发的入口，
// 放进来一个不该收的（登录码、带路径穿越的 token）不会报错，只有被利用时才看得见。
import { describe, expect, it } from "vitest";
import { createDeepLinkRouter, DeepLinkQueue, MAX_PENDING, parseDeepLink } from "../src/main/deepLink";

const TOKEN = "Ab3dEf5hIj7lMn9pQr1tUv";   // 22 位 base62，与服务端 genToken 同形

describe("parseDeepLink", () => {
  it("收名片码与群码，归一成 handleScanRaw 认的 q/<kind>/<token>", () => {
    expect(parseDeepLink(`imdesktop://q/u/${TOKEN}`)).toBe(`q/u/${TOKEN}`);
    expect(parseDeepLink(`imdesktop://q/g/${TOKEN}`)).toBe(`q/g/${TOKEN}`);
  });

  it("容忍尾部斜杠 / query / fragment / 大写 scheme；token 大小写原样保留", () => {
    expect(parseDeepLink(`imdesktop://q/g/${TOKEN}/`)).toBe(`q/g/${TOKEN}`);
    expect(parseDeepLink(`imdesktop://q/g/${TOKEN}?from=web#x`)).toBe(`q/g/${TOKEN}`);
    expect(parseDeepLink(`IMDESKTOP://Q/G/${TOKEN}`)).toBe(`q/g/${TOKEN}`);   // 服务端只认小写 kind
    expect(parseDeepLink(`  imdesktop://q/u/${TOKEN}  `)).toBe(`q/u/${TOKEN}`);
  });

  it("**拒绝登录码 q/l**——网页能触发深链，放行它就是一个 QRLjacking 入口", () => {
    expect(parseDeepLink(`imdesktop://q/l/${TOKEN}`)).toBeNull();
  });

  it("拒绝 token 里的非 base62 字符（路径穿越 / 编码绕过 / 空白）", () => {
    for (const bad of ["../x", "%2F..%2F", "abc def", "a.b", ""]) {
      expect(parseDeepLink(`imdesktop://q/g/${bad}`)).toBeNull();
    }
    expect(parseDeepLink(`imdesktop://q/g/${"a".repeat(65)}`)).toBeNull();
  });

  it("拒绝别的 kind、别的 scheme、缺 // 的写法与普通网址", () => {
    for (const bad of [
      `imdesktop://q/x/${TOKEN}`, `imdesktop://conv/${TOKEN}`, `imdesktop:q/g/${TOKEN}`,
      `imdesktop2://q/g/${TOKEN}`, `https://example.com/q/g/${TOKEN}`, `javascript:alert(1)`, "",
    ]) {
      expect(parseDeepLink(bad)).toBeNull();
    }
  });
});

describe("DeepLinkQueue", () => {
  it("取走即清：同一条不会被处理两次", () => {
    const q = new DeepLinkQueue();
    q.push("q/g/a");
    expect(q.drain()).toEqual(["q/g/a"]);
    expect(q.drain()).toEqual([]);
  });

  it("已在队里的不再入（系统重复投递 / 用户双击）；取走之后同一条可以再来", () => {
    const q = new DeepLinkQueue();
    expect(q.push("q/g/a")).toBe(true);
    expect(q.push("q/g/a")).toBe(false);
    expect(q.drain()).toEqual(["q/g/a"]);
    expect(q.push("q/g/a")).toBe(true);
  });

  it("有界：超过上限丢最旧的，保留最新的", () => {
    const q = new DeepLinkQueue();
    for (let i = 0; i < MAX_PENDING + 3; i++) q.push(`q/g/t${i}`);
    const got = q.drain();
    expect(got).toHaveLength(MAX_PENDING);
    expect(got[got.length - 1]).toBe(`q/g/t${MAX_PENDING + 2}`);
    expect(got[0]).toBe("q/g/t3");
  });
});

describe("createDeepLinkRouter", () => {
  const make = () => {
    const log = { notified: 0, rejected: [] as string[] };
    const r = createDeepLinkRouter(() => { log.notified++; }, (why) => { log.rejected.push(why); });
    return { r, log };
  };

  it("认得的入队并通知页面来取；认不出的记一笔、不通知", () => {
    const { r, log } = make();
    expect(r.acceptUrl(`imdesktop://q/g/${TOKEN}`)).toBe(true);
    expect(r.acceptUrl(`imdesktop://q/l/${TOKEN}`)).toBe(false);
    expect(log.notified).toBe(1);
    expect(log.rejected).toHaveLength(1);
    expect(r.drain()).toEqual([`q/g/${TOKEN}`]);
  });

  it("**拒绝记录里不带 URL 原文**——登录码的 token 不许进日志", () => {
    const { r, log } = make();
    r.acceptUrl(`imdesktop://q/l/${TOKEN}`);
    expect(log.rejected.join(" ")).not.toContain(TOKEN);
  });

  it("argv 里只挑深链：普通启动参数静默跳过，不当成「认不出的深链」", () => {
    const { r, log } = make();
    const n = r.acceptArgv(["/path/Electron", ".", "--im-device-id=x", `imdesktop://q/u/${TOKEN}`, "--original-process-start-time=1"]);
    expect(n).toBe(1);
    expect(log.rejected).toEqual([]);
    expect(r.drain()).toEqual([`q/u/${TOKEN}`]);
  });

  it("重复投递只通知一次（否则页面会为同一条去取两次）", () => {
    const { r, log } = make();
    r.acceptUrl(`imdesktop://q/g/${TOKEN}`);
    r.acceptArgv([`imdesktop://q/g/${TOKEN}`]);
    expect(log.notified).toBe(1);
  });
});
