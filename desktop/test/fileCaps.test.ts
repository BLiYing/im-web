// 外链协议白名单。**这条是安全判据，不是格式校验。**
//
// `shell.openExternal` 把 URL 交给操作系统按协议分发：`file://` 能打开本机任意路径，
// 自定义协议能唤起任意已注册的应用。放行它们等于把页面变成一个任意程序启动器——
// 这是 Electron 上被反复写进安全报告的老洞，而且**放行了也不会报错**，
// 只有被利用时才看得见。所以判据必须是白名单，且必须有测试钉住。
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isExternallyOpenable, writeSavedFile, type FetchLike } from "../src/main/fileCaps";

describe("外链协议白名单", () => {
  it("放行 http / https / mailto", () => {
    expect(isExternallyOpenable("http://example.com/a")).toBe(true);
    expect(isExternallyOpenable("https://example.com/a?b=1#c")).toBe(true);
    expect(isExternallyOpenable("mailto:someone@example.com")).toBe(true);
    // 打包版的媒体走本地同源层，是 http 的
    expect(isExternallyOpenable("http://127.0.0.1:51735/uploads/a.pdf")).toBe(true);
  });

  it("**拒绝** file:// —— 它能打开本机任意路径", () => {
    expect(isExternallyOpenable("file:///etc/passwd")).toBe(false);
    expect(isExternallyOpenable("file:///Applications/Calculator.app")).toBe(false);
  });

  it("**拒绝**自定义协议 —— 它能唤起任意已注册的应用", () => {
    for (const u of ["ms-msdt:/id", "vscode://file/x", "smb://host/share", "javascript:alert(1)",
                     "vbscript:msgbox", "chrome://settings", "app://x"]) {
      expect(isExternallyOpenable(u)).toBe(false);
    }
  });

  it("拒绝渲染进程 origin 里的东西（系统根本没有这个地址）与非法 URL", () => {
    expect(isExternallyOpenable("blob:http://localhost/abc")).toBe(false);
    expect(isExternallyOpenable("data:text/html,<h1>x")).toBe(false);
    expect(isExternallyOpenable("/uploads/a.pdf")).toBe(false);   // 相对路径：解析不了
    expect(isExternallyOpenable("")).toBe(false);
    expect(isExternallyOpenable("not a url")).toBe(false);
  });

  it("大小写与前后空白不能绕过（URL 解析已归一化协议）", () => {
    expect(isExternallyOpenable("HTTPS://example.com")).toBe(true);
    expect(isExternallyOpenable("FILE:///etc/passwd")).toBe(false);
    expect(isExternallyOpenable("  file:///etc/passwd  ")).toBe(false);
  });
});

// ---- 另存：真正写文件那半（带对话框的那半在无人值守里调不了，所以拆开测这半） ----

describe("另存的写文件路径", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), "im-save-")); dirs.push(d); return d; };
  const okFetch = (body: string): FetchLike => async () =>
    new Response(body, { status: 200 });

  it("字节路径：原样落盘", async () => {
    const target = join(tmp(), "a.bin");
    const bytes = new Uint8Array([1, 2, 3, 250]);
    expect(await writeSavedFile(target, { name: "a.bin", bytes }, okFetch(""))).toBe(true);
    expect([...readFileSync(target)]).toEqual([1, 2, 3, 250]);
  });

  it("URL 路径：流式落盘，内容逐字节相同", async () => {
    const target = join(tmp(), "b.txt");
    const body = "x".repeat(100_000);
    expect(await writeSavedFile(target, { name: "b.txt", url: "https://x/b" }, okFetch(body))).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(body);
  });

  it("HTTP 非 200：返回 false，且**不留下任何文件**", async () => {
    const dir = tmp();
    const target = join(dir, "c.bin");
    const notFound: FetchLike = async () => new Response("nope", { status: 404 });
    expect(await writeSavedFile(target, { name: "c.bin", url: "https://x/c" }, notFound)).toBe(false);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.part`)).toBe(false);
  });

  it("**下载中途断掉：目标位置不许出现残缺文件**", async () => {
    // 这是拆出 `.part` 的全部理由。createWriteStream 一开就把目标创建了，
    // 中途断线会在用户选的位置留下一个「看起来完整」的半截文件——一个 200MB 的"视频"，
    // 双击打不开，而且没有任何报错。浏览器版由浏览器管这件事，桌面上得自己管。
    const dir = tmp();
    const target = join(dir, "d.mp4");
    const broken: FetchLike = async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode("头几个字节")); c.error(new Error("网断了")); },
    }), { status: 200 });
    expect(await writeSavedFile(target, { name: "d.mp4", url: "https://x/d" }, broken)).toBe(false);
    expect(existsSync(target)).toBe(false);        // 目标位置干净
    expect(existsSync(`${target}.part`)).toBe(false); // 临时文件也清掉了
  });

  it("**覆盖已有文件时下载失败 → 原文件必须原封不动**", async () => {
    // 这条才是 `.part` + rename 真正买到的东西。上一条（中途断线不留残缺文件）**分辨不出**
    // 两种写法：直接写目标、失败后在 catch 里删掉，那条也能过——2026-09-09 变异验证当场发现，
    // 又是一条「读起来像在守、其实没在守」。
    // 而直接写目标的写法在这里必然露馅：`createWriteStream` 一开就把已有文件**截断**了，
    // 用户"另存覆盖"一个下到一半断线的文件，原来那份就没了——而且没有任何报错。
    const dir = tmp();
    const target = join(dir, "existing.mp4");
    writeFileSync(target, "这是用户原来那份，很重要");
    const broken: FetchLike = async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode("新的头几个字节")); c.error(new Error("网断了")); },
    }), { status: 200 });
    expect(await writeSavedFile(target, { name: "existing.mp4", url: "https://x/d" }, broken)).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("这是用户原来那份，很重要");
  });

  it("既没有 bytes 也没有 url：返回 false，不建文件", async () => {
    const target = join(tmp(), "e.bin");
    expect(await writeSavedFile(target, { name: "e.bin" }, okFetch(""))).toBe(false);
    expect(existsSync(target)).toBe(false);
  });
});
