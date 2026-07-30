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
});
