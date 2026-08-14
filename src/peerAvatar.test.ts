import { describe, it, expect } from "vitest";
import { resolvePeerAvatar, resolvePeerNickname, type PeerSources } from "./peerAvatar";

const empty: PeerSources = { conversations: [], friends: [], groups: [], search: [] };

describe("resolvePeerAvatar", () => {
  it("从群成员表兜底：无会话行也能取到 URL（复现 bug 场景）", () => {
    const src: PeerSources = {
      ...empty,
      groups: [{ members: [{ user_id: "4501", avatar_url: "http://x/4501.png" }] }],
    };
    expect(resolvePeerAvatar("4501", src)).toBe("http://x/4501.png");
  });

  it("会话行优先于群成员表", () => {
    const src: PeerSources = {
      conversations: [{ peer: "4501", peer_avatar_url: "http://conv/a.png" }],
      friends: [],
      groups: [{ members: [{ user_id: "4501", avatar_url: "http://grp/a.png" }] }],
      search: [],
    };
    expect(resolvePeerAvatar("4501", src)).toBe("http://conv/a.png");
  });

  it("优先级：好友 > 群成员 > 搜索", () => {
    const src: PeerSources = {
      conversations: [],
      friends: [{ user_id: "4501", avatar_url: "http://friend/a.png" }],
      groups: [{ members: [{ user_id: "4501", avatar_url: "http://grp/a.png" }] }],
      search: [{ user_id: "4501", avatar_url: "http://search/a.png" }],
    };
    expect(resolvePeerAvatar("4501", src)).toBe("http://friend/a.png");
  });

  it("跨多个群查找命中", () => {
    const src: PeerSources = {
      ...empty,
      groups: [
        { members: [{ user_id: "1001", avatar_url: "http://x/1001.png" }] },
        { members: [{ user_id: "4501", avatar_url: "http://x/4501.png" }] },
      ],
    };
    expect(resolvePeerAvatar("4501", src)).toBe("http://x/4501.png");
  });

  it("空白 URL 视作无，继续向后兜底", () => {
    const src: PeerSources = {
      conversations: [{ peer: "4501", peer_avatar_url: "   " }],
      friends: [],
      groups: [{ members: [{ user_id: "4501", avatar_url: "http://grp/a.png" }] }],
      search: [],
    };
    expect(resolvePeerAvatar("4501", src)).toBe("http://grp/a.png");
  });

  it("全无返回 undefined（调用方回退首字母圈）", () => {
    expect(resolvePeerAvatar("9999", empty)).toBeUndefined();
  });

  it("search 为 null 不炸", () => {
    const src: PeerSources = { conversations: [], friends: [], groups: [], search: null };
    expect(resolvePeerAvatar("4501", src)).toBeUndefined();
  });
});

describe("resolvePeerNickname", () => {
  it("从群成员表兜底昵称", () => {
    const src: PeerSources = {
      ...empty,
      groups: [{ members: [{ user_id: "4501", nickname: "小四" }] }],
    };
    expect(resolvePeerNickname("4501", src)).toBe("小四");
  });

  it("全无返回 undefined（调用方回退 uid）", () => {
    expect(resolvePeerNickname("9999", empty)).toBeUndefined();
  });
});
