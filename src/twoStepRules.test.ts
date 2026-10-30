import { describe, expect, it } from "vitest";
import {
  attemptsLeftOf, codeForSubmit, extractRecoveryCode, groupSecret, isCodeReady, isRecoveryLow, normalizeRecovery, recoveryCopyText, recoveryFileText,
  sanitizeCode6, shouldBlockLeave, statusFooterKey, statusValue, twoStepErrorKey, twoStepErrorText,
} from "./twoStepRules";

const t = (k: string, a?: Record<string, string | number>) => (a ? `${k}|${JSON.stringify(a)}` : k);

describe("6 位码清洗", () => {
  it("滤非数字、截 6 位；「123 456」「123-456」粘贴可还原", () => {
    expect(sanitizeCode6("123 456")).toBe("123456");
    expect(sanitizeCode6("12a3-45b6789")).toBe("123456");
    expect(sanitizeCode6("")).toBe("");
  });
  it("提交就绪：动态码要满 6 位；恢复码归一后满 10 位", () => {
    expect(isCodeReady("code", "12345")).toBe(false);
    expect(isCodeReady("code", "123 456")).toBe(true);
    expect(isCodeReady("recovery", "K7M2Q-9XW3")).toBe(false);
    expect(isCodeReady("recovery", " K7M2Q-9XW3P ")).toBe(true);
  });
});

describe("恢复码归一", () => {
  it("小写、去连字符与空白", () => {
    expect(normalizeRecovery(" K7M2Q - 9XW3P\n")).toBe("k7m2q9xw3p");
    expect(codeForSubmit("recovery", "K7M2Q-9XW3P")).toBe("k7m2q9xw3p");
    expect(codeForSubmit("code", "123 456")).toBe("123456");
  });
});

describe("密钥 4 位一组", () => {
  it("大写分组，尾组不足 4 位也保留，不留尾空格", () => {
    expect(groupSecret("jbswy3dpehpk3pxp")).toBe("JBSW Y3DP EHPK 3PXP");
    expect(groupSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
    expect(groupSecret("ABCD")).toBe("ABCD");
    expect(groupSecret("")).toBe("");
  });
});

describe("错误码 → 文案", () => {
  it("各码映射；码不对在绑定页用长文案、其余场景用短文案", () => {
    expect(twoStepErrorKey(200002, "password")).toBe("twostep.error.password_wrong");
    expect(twoStepErrorKey(200023, "verify")).toBe("twostep.error.not_enabled");
    expect(twoStepErrorKey(200021, "bind")).toBe("twostep.error.code_invalid");
    expect(twoStepErrorKey(200021, "verify")).toBe("twostep.error.code_invalid_short");
    expect(twoStepErrorKey(200021, "login")).toBe("twostep.error.code_invalid_short");
    expect(twoStepErrorKey(200022, "bind")).toBe("twostep.error.expired");
    expect(twoStepErrorKey(200022, "login")).toBe("twostep.error.login_expired");
    expect(twoStepErrorKey(200024, "password")).toBe("twostep.error.already_enabled");
    expect(twoStepErrorKey(200025, "password")).toBe("twostep.error.unavailable");
    expect(twoStepErrorKey(100002, "login")).toBe("twostep.error.rate_limited");
    expect(twoStepErrorKey(999, "login")).toBeUndefined();
  });
  it("登录第二步：attempts_left ≤2 才用剩余次数文案", () => {
    expect(attemptsLeftOf({ attempts_left: 2 })).toBe(2);
    expect(attemptsLeftOf({ attempts_left: 1 })).toBe(1);
    expect(attemptsLeftOf({ attempts_left: 3 })).toBeNull();
    expect(attemptsLeftOf({ attempts_left: 0 })).toBeNull();
    expect(attemptsLeftOf(undefined)).toBeNull();
    expect(twoStepErrorText({ code: 200021, data: { attempts_left: 2 } }, "login", t)).toBe('twostep.error.attempts_left|{"count":2}');
    expect(twoStepErrorText({ code: 200021, data: { attempts_left: 4 } }, "login", t)).toBe("twostep.error.code_invalid_short");
    expect(twoStepErrorText({ code: 200021, data: { attempts_left: 2 } }, "verify", t)).toBe("twostep.error.code_invalid_short"); // 非登录场景不带次数
    expect(twoStepErrorText({ code: 777, message: "boom" }, "verify", t)).toBe("boom");
  });
});

describe("状态页 / 隐私页文案规则", () => {
  it("隐私页右值：未加载留空，加载后 on / off", () => {
    expect(statusValue(null, t)).toBeUndefined();
    expect(statusValue(true, t)).toBe("twostep.status.on");
    expect(statusValue(false, t)).toBe("twostep.status.off");
  });
  it("恢复码 ≤2 个告急（橙色 + footer），告急优先于「未保存」提示", () => {
    expect(isRecoveryLow(2)).toBe(true);
    expect(isRecoveryLow(3)).toBe(false);
    expect(statusFooterKey(2, true)).toBe("twostep.recovery.low_footer");
    expect(statusFooterKey(8, true)).toBe("twostep.recovery.unsaved_footer");
    expect(statusFooterKey(8, false)).toBeNull();
  });
  it("恢复码页：未勾选「已保存」才拦截返回", () => {
    expect(shouldBlockLeave(false)).toBe(true);
    expect(shouldBlockLeave(true)).toBe(false);
  });
  it("恢复码文本：复制 = 每行一个；文件 = 头行 + 空行 + 每行一个", () => {
    expect(recoveryCopyText(["a", "b"])).toBe("a\nb");
    expect(recoveryFileText(["a", "b"], "H")).toBe("H\n\na\nb\n");
  });
});

describe("extractRecoveryCode", () => {
  it("取单个码，大小写 / 首尾空白 / 前缀都不影响", () => {
    expect(extractRecoveryCode("k7m2q-9xw3p")).toBe("k7m2q-9xw3p");
    expect(extractRecoveryCode("  K7M2Q-9XW3P\n")).toBe("k7m2q-9xw3p");
    expect(extractRecoveryCode("1. k7m2q-9xw3p")).toBe("k7m2q-9xw3p");
  });
  it("整份清单（复制全部）取第一个", () => {
    expect(extractRecoveryCode("k7m2q-9xw3p\nn4r8t-5hj6c\nx3v9b-2dm7e")).toBe("k7m2q-9xw3p");
    expect(extractRecoveryCode("IM recovery codes (each works once; keep them safe)\n\nn4r8t-5hj6c\n")).toBe("n4r8t-5hj6c");
  });
  it("无连字符的 10 位也认", () => {
    expect(extractRecoveryCode("k7m2q9xw3p")).toBe("k7m2q-9xw3p");
  });
  it("没有合法码返回 null", () => {
    expect(extractRecoveryCode("")).toBeNull();
    expect(extractRecoveryCode("hello world")).toBeNull();
    expect(extractRecoveryCode("k7m2q-9xw3")).toBeNull();
  });
});
