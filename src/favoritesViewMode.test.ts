import { describe, it, expect, beforeEach } from "vitest";
import { loadFavoritesViewMode, saveFavoritesViewMode, FAVORITES_VIEW_MODE_KEY } from "./favoritesViewMode";

describe("favoritesViewMode（localStorage 持久化）", () => {
  beforeEach(() => { localStorage.removeItem(FAVORITES_VIEW_MODE_KEY); });

  it("默认消息模式", () => { expect(loadFavoritesViewMode()).toBe("messages"); });

  it("保存后可读回；非法值回默认", () => {
    saveFavoritesViewMode("chats");
    expect(loadFavoritesViewMode()).toBe("chats");
    saveFavoritesViewMode("messages");
    expect(loadFavoritesViewMode()).toBe("messages");
    localStorage.setItem(FAVORITES_VIEW_MODE_KEY, "garbage");
    expect(loadFavoritesViewMode()).toBe("messages");
  });
});
