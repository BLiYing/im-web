// 单实例锁的三个判据。锁本身（另一个进程真的被拒）由 `--shell-check` 起探针进程验，
// 这里钉的是「拿到/没拿到锁之后怎么办」——这段判错的后果都不报错：
// 自检撞上正在运行的实例却 exit 0（门禁 fail-open）、或用户再点图标窗口不出来。
import { describe, expect, it } from "vitest";
import {
  EXIT_ALREADY_RUNNING, PROBE_EXIT_ACQUIRED, PROBE_EXIT_DENIED, PROBE_FLAG,
  exitCodeAfterLock, lockDataFor, shouldFocusOnSecondInstance,
} from "../src/main/singleInstance";

describe("lockDataFor", () => {
  it("普通启动 → launch；自检 → self-check", () => {
    expect(lockDataFor(["electron", "."], false)).toEqual({ kind: "launch" });
    expect(lockDataFor(["electron", ".", "--e2e"], true)).toEqual({ kind: "self-check" });
  });

  it("带探针参数 → probe，即使同时带着自检参数", () => {
    expect(lockDataFor(["electron", ".", PROBE_FLAG], false)).toEqual({ kind: "probe" });
    expect(lockDataFor(["electron", ".", "--shell-check", PROBE_FLAG], true)).toEqual({ kind: "probe" });
  });
});

describe("exitCodeAfterLock", () => {
  it("拿到锁：普通启动与自检都继续（null）", () => {
    expect(exitCodeAfterLock({ kind: "launch" }, true)).toBeNull();
    expect(exitCodeAfterLock({ kind: "self-check" }, true)).toBeNull();
  });

  it("**自检被拒必须非零退出**——exit 0 会让门禁看起来像通过了", () => {
    expect(exitCodeAfterLock({ kind: "self-check" }, false)).toBe(EXIT_ALREADY_RUNNING);
    expect(EXIT_ALREADY_RUNNING).not.toBe(0);
  });

  it("普通启动被拒：退 0（用户只是又点了一次图标，不是错误）", () => {
    expect(exitCodeAfterLock({ kind: "launch" }, false)).toBe(0);
  });

  it("探针无论结果都退出，且两种结果的退出码分得开", () => {
    expect(exitCodeAfterLock({ kind: "probe" }, false)).toBe(PROBE_EXIT_DENIED);
    expect(exitCodeAfterLock({ kind: "probe" }, true)).toBe(PROBE_EXIT_ACQUIRED);
    expect(PROBE_EXIT_DENIED).not.toBe(PROBE_EXIT_ACQUIRED);
  });
});

describe("shouldFocusOnSecondInstance", () => {
  it("用户又启动了一次 → 把窗口叫出来", () => {
    expect(shouldFocusOnSecondInstance({ kind: "launch" })).toBe(true);
  });

  it("探针与自检 → 不打扰用户正在用的窗口", () => {
    expect(shouldFocusOnSecondInstance({ kind: "probe" })).toBe(false);
    expect(shouldFocusOnSecondInstance({ kind: "self-check" })).toBe(false);
  });

  it("认不出来的数据（老外壳不带 additionalData）→ 按用户点图标处理，叫出来", () => {
    for (const d of [undefined, null, {}, "launch", 42, { kind: "whatever" }]) {
      expect(shouldFocusOnSecondInstance(d)).toBe(true);
    }
  });
});
