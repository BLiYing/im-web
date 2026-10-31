import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import {
  emailErrorText, emailRowValue, isPlausibleEmail, resendDeadline, resendRemaining, retryAfterSecOf, trimEmail,
} from "./emailRules";

const err = (code: number, data?: unknown) => Object.assign(new Error("srv"), { code, data });

describe("isPlausibleEmail", () => {
  it("合规", () => {
    for (const e of ["a@b.com", "a+tag@b.co.uk", "A.B@Example.COM"]) expect(isPlausibleEmail(e), e).toBe(true);
  });
  it("不合规：空 / 无@ / 多@ / @后无点 / 空白 / 超长 / @在首", () => {
    for (const e of ["", "abc", "a@@b.com", "a@b@c.com", "a@bcom", "a b@c.com", "a@b .com", "a@b.com\n", "@b.com"]) expect(isPlausibleEmail(e), JSON.stringify(e)).toBe(false);
    expect(isPlausibleEmail(`${"a".repeat(249)}@b.com`)).toBe(false); // 255
    expect(isPlausibleEmail(`${"a".repeat(248)}@b.com`)).toBe(true); // 恰 254
  });
  it("trimEmail 去首尾空白", () => { expect(trimEmail("  a@b.com \n")).toBe("a@b.com"); });
});

describe("emailErrorText 错误码映射", () => {
  it("逐码", () => {
    const m: [number, string][] = [
      [200002, t("email.err.password")], [200030, t("email.err.invalid")], [200031, t("email.err.taken")],
      [200033, t("email.code.expired")], [200034, t("email.err.not_bound")], [200035, t("email.err.same")],
      [200036, t("email.err.unavailable")], [200037, t("email.err.send_failed")],
    ];
    for (const [c, txt] of m) expect(emailErrorText(err(c), t), String(c)).toBe(txt);
  });
  it("200032：attempts_left ≤2 追加剩余次数，否则只提示错码", () => {
    expect(emailErrorText(err(200032), t)).toBe(t("email.code.wrong"));
    expect(emailErrorText(err(200032, { attempts_left: 4 }), t)).toBe(t("email.code.wrong"));
    expect(emailErrorText(err(200032, { attempts_left: 2 }), t)).toBe(t("email.code.wrong_left", { n: 2 }));
    expect(emailErrorText(err(200032, { attempts_left: 1 }), t)).toBe(t("email.code.wrong_left", { n: 1 }));
  });
  it("100002：有 retry_after_sec>0 带秒数，否则通用", () => {
    expect(emailErrorText(err(100002, { retry_after_sec: 42 }), t)).toBe(t("email.err.too_frequent_secs", { n: 42 }));
    expect(emailErrorText(err(100002), t)).toBe(t("email.err.too_frequent"));
    expect(emailErrorText(err(100002, { retry_after_sec: 0 }), t)).toBe(t("email.err.too_frequent"));
  });
  it("未知码退回 message；无 message 退回网络错误", () => {
    expect(emailErrorText(err(999), t)).toBe("srv");
    expect(emailErrorText({}, t)).toBe(t("net.error.cannot_connect"));
  });
});

describe("重发倒计时规则", () => {
  it("deadline / remaining：向上取整，到点归零", () => {
    expect(resendDeadline(1000, 60)).toBe(61000);
    expect(resendDeadline(1000, 0)).toBe(0);
    expect(resendDeadline(1000, NaN)).toBe(0);
    expect(resendRemaining(61000, 1000)).toBe(60);
    expect(resendRemaining(61000, 1001)).toBe(60);
    expect(resendRemaining(61000, 60001)).toBe(1);
    expect(resendRemaining(61000, 61000)).toBe(0);
    expect(resendRemaining(0, 5)).toBe(0);
  });
  it("retryAfterSecOf：数字取整，缺失 null，0 保留", () => {
    expect(retryAfterSecOf({ retry_after_sec: 7.2 })).toBe(8);
    expect(retryAfterSecOf({ retry_after_sec: 0 })).toBe(0);
    expect(retryAfterSecOf({})).toBeNull();
    expect(retryAfterSecOf(undefined)).toBeNull();
  });
});

describe("emailRowValue", () => {
  it("未加载留空；已绑定显示邮箱；未绑定显示「未绑定」", () => {
    expect(emailRowValue(null, t)).toBeUndefined();
    expect(emailRowValue({ available: true, bound: true, email: "a@b.com", verifiedAt: 1 }, t)).toBe("a@b.com");
    expect(emailRowValue({ available: true, bound: false, email: "", verifiedAt: 0 }, t)).toBe(t("email.status.unbound"));
  });
});
