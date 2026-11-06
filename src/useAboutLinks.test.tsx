// @vitest-environment jsdom
// 缓存按 token 分键：换账号 / 匿名不会拿到别人的客服链接。
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const fetchAboutLinks = vi.fn();
vi.mock("./sdk/aboutLinksApi", () => ({ fetchAboutLinks: (...a: unknown[]) => fetchAboutLinks(...a) }));

import { useAboutLinks } from "./useAboutLinks";

describe("useAboutLinks", () => {
  it("账号 A 的结果不会作为账号 B 的初值", async () => {
    fetchAboutLinks.mockResolvedValueOnce({ customer_service_url: "https://cs.example.com/?ck=A" });
    const a = renderHook(() => useAboutLinks(() => "tokA"));
    await waitFor(() => expect(a.result.current?.customer_service_url).toContain("ck=A"));
    fetchAboutLinks.mockReturnValueOnce(new Promise(() => {}));
    const b = renderHook(() => useAboutLinks(() => "tokB"));
    expect(b.result.current).toBeNull();
  });
});
