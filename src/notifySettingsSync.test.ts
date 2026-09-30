// 账号级通知设置同步（M5）：merge/migration 决策 + wire 映射的纯函数回归。
// 运行时胶水（网络/localStorage）在 useAccountNotifySettings.test.ts 里覆盖。
import { describe, it, expect } from "vitest";
import {
  accountFieldsFromWire, accountFieldsToWire, decideLoginSync, shouldRefetchOnFrame,
  type AccountNotifyFields,
} from "./notifySettingsSync";
import { DEFAULT_NOTIFY_SETTINGS } from "./notifySettings";

const fields = (over: Partial<AccountNotifyFields> = {}): AccountNotifyFields => ({
  private: DEFAULT_NOTIFY_SETTINGS.private,
  group: DEFAULT_NOTIFY_SETTINGS.group,
  badge: DEFAULT_NOTIFY_SETTINGS.badge,
  ...over,
});

describe("decideLoginSync：登录/重连动作判定", () => {
  it("dirty=true → 恒 retry_push，不看 exists（本地未送达的编辑优先，绝不能被覆盖）", () => {
    expect(decideLoginSync(true, false)).toBe("retry_push");
    expect(decideLoginSync(true, true)).toBe("retry_push");
  });
  it("dirty=false, exists=false → migrate_push（首次迁移，把本地现值推上去）", () => {
    expect(decideLoginSync(false, false)).toBe("migrate_push");
  });
  it("dirty=false, exists=true → overwrite_local（服务端已有，覆盖本地）", () => {
    expect(decideLoginSync(false, true)).toBe("overwrite_local");
  });
});

describe("shouldRefetchOnFrame：notify_settings_update 帧版本比对", () => {
  it("帧版本比本地新 → true", () => {
    expect(shouldRefetchOnFrame(4, 3)).toBe(true);
  });
  it("帧版本等于/小于本地 → false（不重复拉，避免多端来回互推）", () => {
    expect(shouldRefetchOnFrame(3, 3)).toBe(false);
    expect(shouldRefetchOnFrame(2, 3)).toBe(false);
  });
});

describe("accountFieldsToWire：本地 → wire", () => {
  it("badge.includeMuted → badge.include_muted；private/group 字段原样透传", () => {
    const f = fields({ badge: { includeMuted: true }, private: { enabled: false, preview: true, sound: "chime" } });
    const wire = accountFieldsToWire(f);
    expect(wire.badge).toEqual({ include_muted: true });
    expect(wire.private).toEqual({ enabled: false, preview: true, sound: "chime" });
    expect(wire.group).toEqual(f.group);
  });
});

describe("accountFieldsFromWire：wire → 本地，per-field 回落", () => {
  const fallback = fields({ badge: { includeMuted: false } });

  it("完整合法输入：正常解析，include_muted → includeMuted", () => {
    const r = accountFieldsFromWire({
      private: { enabled: true, preview: false, sound: "rise" },
      group: { enabled: false, preview: true, sound: "drop" },
      badge: { include_muted: true },
    }, fallback);
    expect(r.private).toEqual({ enabled: true, preview: false, sound: "rise" });
    expect(r.group).toEqual({ enabled: false, preview: true, sound: "drop" });
    expect(r.badge).toEqual({ includeMuted: true });
  });

  it("未知 sound 值回落 default（与 normalizeSoundId 同口径，不回落 fallback.sound）", () => {
    const r = accountFieldsFromWire({ private: { enabled: true, preview: true, sound: "xylophone" } }, fallback);
    expect(r.private.sound).toBe("default");
  });

  it("badge.include_muted 非法类型 → 回落 fallback", () => {
    const r = accountFieldsFromWire({ badge: { include_muted: "yes" } }, fallback);
    expect(r.badge.includeMuted).toBe(fallback.badge.includeMuted);
  });

  it("空/垃圾输入 → 整体回落 fallback", () => {
    expect(accountFieldsFromWire(undefined, fallback)).toEqual(fallback);
    expect(accountFieldsFromWire(null, fallback)).toEqual(fallback);
    expect(accountFieldsFromWire("nope", fallback)).toEqual(fallback);
  });

  it("缺 group 字段 → group 整段回落 fallback.group，不影响 private", () => {
    const r = accountFieldsFromWire({ private: { enabled: false, preview: false, sound: "none" } }, fallback);
    expect(r.group).toEqual(fallback.group);
    expect(r.private).toEqual({ enabled: false, preview: false, sound: "none" });
  });
});
