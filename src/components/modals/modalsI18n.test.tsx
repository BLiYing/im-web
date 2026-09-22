// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setPref, t } from "../../i18n";
import { userCardAction } from "../../qr";
import { favDate } from "./FavoritesItems";
import { GroupBansModal } from "./GroupBansModal";
import type { QRUserCard } from "../../sdk/protocol";

afterEach(() => { cleanup(); setPref("zh-Hans"); });

describe("W1 弹窗文案：中英两种输出", () => {
  it("复数与占位符（名片发送 / 一图多码 / 群成员数）", () => {
    expect(t("contact.card.send_many", { count: 3, name: "群" })).toBe("发送 3 张名片给「群」");
    expect(t("qr.branch.group_meta_invited", { count: 5, name: "小明" })).toBe("5 名成员 · 小明 邀请你加入");
    setPref("en");
    expect(t("contact.card.send_one", { name: "Team" })).toBe('Send contact card to "Team"');
    expect(t("contact.card.send_many", { count: 3, name: "Team" })).toBe('Send 3 contact cards to "Team"');
    expect(t("qr.scan.multi_title", { count: 2 })).toBe("There are 2 QR codes in this image. Choose which to open:");
    expect(t("fav.record.count", { count: 1 })).toBe("1 message");
    expect(t("group.admin_picker.add_count", { selected: 2, max: 10 })).toBe("Add (2/10)");
  });

  it("非组件函数随语言变：favDate / qr 动作 label", () => {
    const ts = new Date(2020, 0, 5, 9, 7).getTime();
    expect(favDate(ts)).toBe("2020年1月5日 09:07");
    setPref("en");
    expect(favDate(ts)).toBe("Jan 5, 2020 09:07");
    expect(userCardAction({ relation: "stranger" } as QRUserCard).label).toBe("Add to contacts");
  });

  it("组件切语言：ForwardPicker / GroupBansModal", () => {
    setPref("en");
    render(<GroupBansModal bans={[]} remarks={new Map()} onUnban={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Blocklist (0)")).toBeTruthy();
    expect(screen.getByText("No blocked members")).toBeTruthy();
  });
});
