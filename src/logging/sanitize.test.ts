import { describe, expect, it } from "vitest";
import { formatRequestBody, formatResponseText, sanitizeValue } from "./sanitize";

describe("HTTP 日志脱敏", () => {
  it("递归隐藏凭据、token、手机号和 secret", () => {
    const safe = sanitizeValue({
      username: "a1002",
      password: "pw",
      data: { access_token: "jwt", client_secret: "secret", phone: "13812345678", content: "hello" },
    }, true) as Record<string, any>;
    expect(safe.username).toBe("a1002");
    expect(safe.password).toBe("***");
    expect(safe.data.access_token).toBe("***");
    expect(safe.data.client_secret).toBe("***");
    expect(safe.data.phone).toBe("***");
    expect(safe.data.content).toBe("hello");
  });

  it("邮箱登录：完整 email 与字符串验证码不落日志，email_masked 保留", () => {
    const safe = sanitizeValue({ email: "a@b.com", code: "123456", data: { email: "a@b.com", email_masked: "a***@b.com" } }, true) as Record<string, any>;
    expect(safe.email).toBe("***");
    expect(safe.code).toBe("***");
    expect(safe.data.email).toBe("***");
    expect(safe.data.email_masked).toBe("a***@b.com");
  });

  it("登录名填了邮箱：username 含 @ 时脱敏，普通用户名保留", () => {
    const safe = sanitizeValue({ username: "Me@Example.com" }, true) as Record<string, any>;
    expect(safe.username).toBe("***");
    expect((sanitizeValue({ username: "plain_user" }, true) as Record<string, any>).username).toBe("plain_user");
  });

  it("生产模式隐藏业务正文", () => {
    const safe = sanitizeValue({ content: "private", data: [{ text: "nested", code: 0 }] }, false) as Record<string, any>;
    expect(safe.content).toBe("***");
    expect(safe.data[0].text).toBe("***");
    expect(safe.data[0].code).toBe(0);
  });

  it("JSON 内嵌 Data URI 只记录元数据", () => {
    const safe = sanitizeValue({ avatar_url: "data:image/jpeg;base64,/9j/secret-binary" }, true) as Record<string, string>;
    expect(safe.avatar_url).toBe("<data-uri type=image/jpeg chars=40>");
    expect(safe.avatar_url).not.toContain("secret-binary");
  });

  it("multipart 文件只记录文件元数据且字段仍脱敏", () => {
    const form = new FormData();
    form.append("password", "pw");
    form.append("file", new File(["secret bytes"], "avatar.jpg", { type: "image/jpeg" }));
    const logged = formatRequestBody(form, true);
    expect(logged).toContain("\"password\":\"***\"");
    expect(logged).toContain("<file name=avatar.jpg type=image/jpeg bytes=12>");
    expect(logged).not.toContain("secret bytes");
  });

  it("无 Content-Type 的 JSON 仍脱敏，生产模式不输出纯文本", () => {
    expect(formatResponseText('{"token":"jwt"}', null, true)).toBe('{"token":"***"}');
    expect(formatResponseText("private upstream error", "text/plain", false)).toBe("<non-json redacted 22 chars>");
  });
  it("导出下载链接的一次性 token 不落日志", () => {
    const safe = sanitizeValue({ url: "/api/v1/exports/download?t=abc.def", other: "/api/v1/x?t=keep" }, true) as Record<string, string>;
    expect(safe.url).toBe("/api/v1/exports/download?t=***");
    expect(safe.other).toBe("/api/v1/x?t=keep");
    expect(formatResponseText('{"data":{"url":"/api/v1/exports/download?t=SECRET&x=1","expires_in":600}}', "application/json", false)).not.toContain("SECRET");
  });
});

describe("两步验证脱敏", () => {
  it("ticket / otpauth_uri / secret / 恢复码 / 字符串 code 全部隐藏，数字 code（信封业务码）保留", () => {
    const safe = sanitizeValue({
      code: 200020, ticket: "T-123", otpauth_uri: "otpauth://totp/IM:a?secret=ABC", secret: "ABC", recovery_codes: ["k7m2q-9xw3p"],
      data: { code: "123456", password: "pw" },
    }, true) as Record<string, any>;
    expect(safe.code).toBe(200020);
    expect(safe.ticket).toBe("***");
    expect(safe.otpauth_uri).toBe("***");
    expect(safe.secret).toBe("***");
    expect(safe.recovery_codes).toBe("***");
    expect(safe.data.code).toBe("***");
    expect(JSON.stringify(safe)).not.toContain("k7m2q");
  });
});
