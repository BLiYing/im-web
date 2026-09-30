// PUT /api/v1/notify-settings 的请求体形状（PROTOCOL §11：`{settings:{…}}`，与 GET 同形）。
// 曾经本端发的是裸 settings，而 iOS/Android 按协议包一层——服务端只认其中一种，另一方全部保存失败（M5 批 1 /code-review）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { putNotifySettings } from "./notifySettingsApi";

afterEach(() => { vi.unstubAllGlobals(); });

describe("putNotifySettings", () => {
  it("请求体包在 settings 里", async () => {
    let sent: unknown;
    vi.stubGlobal("fetch", vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ code: 0, data: { version: 1, exists: true, settings: {} } }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const settings = {
      private: { enabled: true, preview: true, sound: "default" },
      group: { enabled: true, preview: true, sound: "default" },
      badge: { include_muted: false },
    };
    await putNotifySettings("jwt", settings as never);
    expect(sent).toEqual({ settings });
  });
});
