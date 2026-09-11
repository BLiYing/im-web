// 全局快捷键（D4 收尾）：一个固定组合键显示 / 隐藏主窗口。**默认关，设置里开**（2026-09-11 拍板）。
//
// 为什么默认关：全局快捷键是在**系统范围**抢一个组合键。装好就注册的话，用户别的应用里同一个组合键
// 会被静默盖掉——而且盖掉时不报错，用户只会觉得「那个应用的快捷键坏了」，很难联想到是我们。
//
// 组合键固定为 ⌃⌘W（macOS，微信 Mac 版同款）/ Ctrl+Alt+W（Windows）。可自定义留作以后。
//
// 本文件**不 import electron**：注册器、偏好读写、按下后做什么全部注入。
// 这样「被别的应用占用时怎么办」这类分支才测得到——真的 globalShortcut 在测试里造不出「被占用」。

/** Electron `globalShortcut` 用得到的那三个方法。 */
export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  isRegistered(accelerator: string): boolean;
}

/** 页面看到的状态。`enabled` 是**真的注册上了**，不是偏好；`taken` 只在「想开但被占用」时为 true。 */
export interface GlobalShortcutState {
  enabled: boolean;
  label: string;
  taken?: boolean;
}

export function shortcutAccelerator(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "Control+Command+W" : "Control+Alt+W";
}

/** 设置页上给人看的写法。 */
export function shortcutLabel(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "⌃⌘W" : "Ctrl+Alt+W";
}

/** 按下之后：窗口在前台就收起，否则叫出来（被别的窗口挡住、最小化、收进托盘都算「不在前台」）。 */
export function toggleActionFor(visible: boolean, focused: boolean): "hide" | "show" {
  return visible && focused ? "hide" : "show";
}

export interface GlobalShortcutDeps {
  registry: ShortcutRegistry;
  platform: NodeJS.Platform;
  /** 读偏好（用户上次是否开了）。 */
  load: () => boolean;
  /** 写偏好。 */
  save: (on: boolean) => void;
  onPress: () => void;
  /** 只给 `--shell-check` 用：换一个不会和任何人冲突的组合键去验真注册器。 */
  accelerator?: string;
}

export interface GlobalShortcut {
  /** 启动时按偏好注册。 */
  restore(): void;
  state(): GlobalShortcutState;
  /** 开 / 关，返回**设完之后的真实状态**（同 setAutoStart 的口径）。 */
  set(on: boolean): GlobalShortcutState;
  /** 退出前释放。 */
  dispose(): void;
}

export function createGlobalShortcut(deps: GlobalShortcutDeps): GlobalShortcut {
  const accelerator = deps.accelerator ?? shortcutAccelerator(deps.platform);
  const label = shortcutLabel(deps.platform);
  // **只释放自己注册上的**：注册失败说明组合键在别的应用手里，那时 unregister 等于去拆别人的。
  let mine = false;

  const claim = (): boolean => {
    if (mine) return true;   // 已经是我们的：别重复注册（Electron 对重复注册返回 false，会被误判成「被占用」）
    try {
      mine = deps.registry.register(accelerator, deps.onPress);
    } catch {
      mine = false;          // 非法组合键 / 平台不支持（Linux Wayland）
    }
    return mine;
  };
  const release = (): void => {
    if (!mine) return;
    try { deps.registry.unregister(accelerator); } catch { /* 进程要退了，拆不掉也无妨 */ }
    mine = false;
  };

  return {
    // 偏好是开、但这次注册不上（占用它的应用先启动了）：**不改偏好**。那个应用退出后下次启动还能拿到；
    // 状态如实报 enabled=false，设置页开关显示关，用户点一下就会再试一次。
    restore: () => { if (deps.load()) claim(); },
    state: () => ({ enabled: mine, label }),
    set: (on) => {
      if (!on) {
        release();
        deps.save(false);
        return { enabled: false, label };
      }
      const ok = claim();
      // 注册不上就不记「开」：否则下次启动又去抢一个明知在别人手里的组合键。
      deps.save(ok);
      return ok ? { enabled: true, label } : { enabled: false, label, taken: true };
    },
    dispose: release,
  };
}
