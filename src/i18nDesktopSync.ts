// 把界面语言偏好同步给宿主（桌面主进程要本地化托盘菜单等页面之外的文案，见 platform/types.ts 的 setLanguage）。
// 启动时推一次、之后每次切换再推。浏览器宿主的 setLanguage 是 no-op，调用无副作用。
import { getPref, subscribe } from "./i18n";
import { platform } from "./platform";
import { logger, LOG_TAG } from "./logging/logger";

export function installLanguageSync(): () => void {
  const push = (): void => {
    platform().setLanguage(getPref()).catch((e: unknown) => {
      logger.warn(LOG_TAG.app, "language_sync_failed", { err: (e as Error).message });
    });
  };
  push();
  return subscribe(push);
}
