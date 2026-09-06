import { beforeEach, describe, expect, it } from "vitest";
import { loadSession, saveSession, SESSION_KEY } from "./session";

function raw(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
}

describe("保持登录：存续期凭据而非明文密码", () => {
  beforeEach(() => localStorage.clear());

  it("落盘只写 uid/username/refresh，绝不写密码", () => {
    saveSession({ uid: "1001", username: "a1002", refresh: "R1" });
    expect(raw()).toEqual({ uid: "1001", username: "a1002", refresh: "R1" });
    expect(JSON.stringify(raw())).not.toContain("pwd");
  });

  it("扫码会话：token 与 refresh 一起存（token 供首次入场直连，续期仍靠 refresh）", () => {
    saveSession({ uid: "1001", username: "1001", refresh: "R1", token: "T1" });
    expect(raw()).toMatchObject({ token: "T1", refresh: "R1" });
  });

  it("读回自己写的会话", () => {
    saveSession({ uid: "1001", username: "a1002", refresh: "R1" });
    expect(loadSession()).toEqual({ uid: "1001", username: "a1002", refresh: "R1", token: undefined, legacyPwd: undefined });
  });

  // 迁移垫片：改版前的用户本地存的是 {uid, username, pwd}。读得出来才能用它换一次
  // refresh；换到之后 saveSession 写的新结构里没有 pwd，明文密码就此从磁盘上消失。
  it("老会话里的明文密码读作 legacyPwd（一次性迁移用）", () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ uid: "1001", username: "a1002", pwd: "secret" }));
    const s = loadSession();
    expect(s).toMatchObject({ uid: "1001", username: "a1002", refresh: "", legacyPwd: "secret" });
  });

  it("迁移后重新落盘 → 明文密码被覆盖掉", () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ uid: "1001", username: "a1002", pwd: "secret" }));
    const s = loadSession()!;
    saveSession({ uid: s.uid, username: s.username, refresh: "R1" });
    expect(JSON.stringify(raw())).not.toContain("secret");
    expect(loadSession()?.legacyPwd).toBeUndefined();
  });

  it("扫码会话没有 username → 回退 uid（它靠 token/refresh 重连，不走 /login）", () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ uid: "1001", token: "T1" }));
    expect(loadSession()).toMatchObject({ uid: "1001", username: "1001", token: "T1" });
  });

  it("没有 uid / 坏 JSON → null（回登录页，不炸）", () => {
    expect(loadSession()).toBeNull();
    localStorage.setItem(SESSION_KEY, "{oops");
    expect(loadSession()).toBeNull();
    localStorage.setItem(SESSION_KEY, JSON.stringify({ username: "a1002", refresh: "R1" }));
    expect(loadSession()).toBeNull();
  });
});
