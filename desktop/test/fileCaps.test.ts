// 外链协议白名单。**这条是安全判据，不是格式校验。**
//
// `shell.openExternal` 把 URL 交给操作系统按协议分发：`file://` 能打开本机任意路径，
// 自定义协议能唤起任意已注册的应用。放行它们等于把页面变成一个任意程序启动器——
// 这是 Electron 上被反复写进安全报告的老洞，而且**放行了也不会报错**，
// 只有被利用时才看得见。所以判据必须是白名单，且必须有测试钉住。
import { describe, expect, it } from "vitest";
import { isExternallyOpenable } from "../src/main/fileCaps";

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
