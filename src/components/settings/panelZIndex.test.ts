// 隐私与安全页（z-index 40）的所有二级页必须在 styles.css 的 z-index:50 规则里登记，
// 否则面板能挂载、能点，但被隐私页盖在下面看不见（2026-10-26 浏览器实测踩到，jsdom 看不出）。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("隐私与安全二级页层级", () => {
  const css = readFileSync(resolve(__dirname, "../../styles.css"), "utf8");
  const rule = css.split("\n").find((l) => l.includes("{ z-index: 50; }") && l.includes(".autodel-panel")) ?? "";
  it.each(["blocked-panel", "changepwd-panel", "autodel-panel", "visibility-panel", "export-panel"])("%s 在 z-index:50 规则内", (cls) => {
    expect(rule).toContain(`.${cls}`);
  });
});
