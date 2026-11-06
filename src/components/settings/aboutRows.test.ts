// 关于我们二级页的行列表：在线客服行只在有客服地址时出现，位置在「技术支持」与「版本」之间。
import { describe, expect, it, vi } from "vitest";
import { aboutPanelRows } from "./aboutRows";

const t = (k: string) => k;

describe("aboutPanelRows", () => {
  it("有客服地址：隐私 / 条款 / 技术支持 / 在线客服 / 版本，共 5 行且顺序固定", () => {
    const rows = aboutPanelRows(t, { version: "1.0", showCustomerService: true, onOpen: vi.fn(), onCopyVersion: vi.fn() });
    expect(rows.map((r) => r.id)).toEqual(["about_privacy", "about_terms", "about_support", "about_customer_service", "about_version"]);
    expect(rows[3].label).toBe("about.customer_service");
    expect(rows[3].chevron).toBe(true);
  });

  it("客服地址为空：不含在线客服行（其余四行不变）", () => {
    const rows = aboutPanelRows(t, { version: "1.0", showCustomerService: false, onOpen: vi.fn(), onCopyVersion: vi.fn() });
    expect(rows.map((r) => r.id)).toEqual(["about_privacy", "about_terms", "about_support", "about_version"]);
  });

  it("点击回调携带对应 kind；版本行无 chevron、有右值", () => {
    const onOpen = vi.fn(); const onCopy = vi.fn();
    const rows = aboutPanelRows(t, { version: "9.9 (abc)", showCustomerService: true, onOpen, onCopyVersion: onCopy });
    rows.slice(0, 4).forEach((r) => r.onClick());
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual(["privacy", "terms", "support", "customerService"]);
    const version = rows[4];
    expect(version.chevron).toBeFalsy();
    expect(version.value).toBe("9.9 (abc)");
    version.onClick();
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
