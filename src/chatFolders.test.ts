// 聊天文件夹纯逻辑：读三端共用向量（testing/chatFolderLogic.vectors.json，源 IMServer docs/conformance/chat_folder_logic.json）。
// 横滑判定（swipe / tail_zone）是触屏端的事，Web 不做滑动、不读。
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import vectors from "./testing/chatFolderLogic.vectors.json";
import type { Conversation } from "./sdk/protocol";
import {
  DEFAULT_FOLDER_LIMITS, filterConversations, folderBadge, folderTabIndex, foldersContaining,
  parseFolderSnapshot, runeLength, shouldApplySnapshot, type ChatFolder,
} from "./chatFolders";

interface VConv { conv_id: string; unread: number; muted: boolean; mute_until: number; marked_unread: boolean; mention_unread: boolean }
interface BadgeCase { name: string; now: number; folder: string[] | null; convs: VConv[]; expect: { count: number; muted: boolean } }

const conv = (v: VConv) => ({
  conv_id: v.conv_id, unread: v.unread, muted: v.muted, mute_until: v.mute_until,
  marked_unread: v.marked_unread, mention_unread: v.mention_unread,
}) as unknown as Conversation;

describe("chat_folder_logic 共用向量", () => {
  const badge = (vectors as unknown as { badge: BadgeCase[] }).badge;
  it("向量不少于 9 条", () => expect(badge.length).toBeGreaterThanOrEqual(9));
  for (const c of badge) {
    it(`角标：${c.name}`, () => {
      const folder: ChatFolder | null = c.folder ? { id: "f", name: "x", position: 0, conv_ids: c.folder } : null;
      expect(folderBadge(c.convs.map(conv), folder, c.now)).toEqual(c.expect);
    });
  }
  it("本地副本与源向量一致（源在本机时才比）", () => {
    const abs = new URL("../../IMServer/docs/conformance/chat_folder_logic.json", import.meta.url);
    if (!existsSync(abs)) return;
    expect(JSON.parse(readFileSync(abs, "utf8"))).toEqual(vectors);
  });
});

describe("快照解析与版本去重", () => {
  it("按 position 排序、conv_ids 永不为 null、缺 limits 沿用兜底", () => {
    const s = parseFolderSnapshot({ version: 3, folders: [
      { id: "b", name: "B", position: 1, conv_ids: ["x"] },
      { id: "a", name: "A", position: 0 },
    ] });
    expect(s!.folders.map((f) => f.id)).toEqual(["a", "b"]);
    expect(s!.folders[0].conv_ids).toEqual([]);
    expect(s!.limits).toEqual(DEFAULT_FOLDER_LIMITS);
  });
  it("limits 取服务端值，非法项被跳过不连累整表", () => {
    const s = parseFolderSnapshot({ version: 1, limits: { max_folders: 5, max_convs: 20, max_name: 8 },
      folders: [{ id: "", name: "bad" }, { id: "ok", name: "OK", position: 0, conv_ids: [] }] });
    expect(s!.limits).toEqual({ max_folders: 5, max_convs: 20, max_name: 8 });
    expect(s!.folders.map((f) => f.id)).toEqual(["ok"]);
  });
  it("形状不对返回 null（调用方丢弃，别当成空表）", () => {
    expect(parseFolderSnapshot(null)).toBeNull();
    expect(parseFolderSnapshot({ version: 1 })).toBeNull();
  });
  it("版本严格更新才采纳", () => {
    expect(shouldApplySnapshot(5, 6)).toBe(true);
    expect(shouldApplySnapshot(5, 5)).toBe(false);
    expect(shouldApplySnapshot(5, 4)).toBe(false);
  });
});

describe("过滤 / Tab 下标 / 归属", () => {
  const all = ["a", "b", "c"].map((id) => ({ conv_id: id }) as unknown as Conversation);
  const f1: ChatFolder = { id: "f1", name: "A", position: 0, conv_ids: ["c", "a"] };
  const f2: ChatFolder = { id: "f2", name: "B", position: 1, conv_ids: ["a"] };
  it("保序过滤，「全部」返回同一数组", () => {
    expect(filterConversations(all, f1).map((c) => c.conv_id)).toEqual(["a", "c"]);
    expect(filterConversations(all, null)).toBe(all);
  });
  it("tabIndex：选中的被删回落全部", () => {
    expect(folderTabIndex(null, [f1, f2])).toBe(0);
    expect(folderTabIndex("f2", [f1, f2])).toBe(2);
    expect(folderTabIndex("gone", [f1, f2])).toBe(0);
  });
  it("foldersContaining 按 position 顺序", () => {
    expect(foldersContaining([f1, f2], "a").map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(foldersContaining([f1, f2], "b")).toEqual([]);
  });
  it("名称长度按码点（emoji 算 1）", () => {
    expect(runeLength("工作😀")).toBe(3);
  });
});
