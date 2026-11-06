import { SubPanel } from "./SubPanel";
import { renderRow } from "../rows";
import { aboutPanelRows } from "./aboutRows";
import { currentVersion, resolveAboutLink, versionClipboardText, type AboutLinkKind } from "../../aboutLinks";
import { platform } from "../../platform";
import { useAppServices } from "../../AppServicesContext";
import { getLang, useT } from "../../i18n";
import { useAboutLinks } from "../../useAboutLinks";

/** 关于我们（对齐 iOS IMAboutViewController / Android AboutScreen）：隐私政策 / 服务条款 / 技术支持 /（有地址才显示）在线客服 / 版本。
 *  纯展示：动作由容器注入。版本行无 chevron、有右值，点一下复制。 */
export function AboutPanel({ version, showCustomerService, onOpen, onCopyVersion, onBack }: {
  version: string;
  showCustomerService: boolean;
  onOpen: (kind: AboutLinkKind) => void;
  onCopyVersion: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const rows = aboutPanelRows(t, { version, showCustomerService, onOpen, onCopyVersion });
  return (
    <SubPanel className="about-panel" title={t("about.title")} onBack={onBack}>
      <div className="settings-group">{rows.map((r) => renderRow(r, "settings-row"))}</div>
    </SubPanel>
  );
}

/** 接好链接打开 / 复制 / 轻提示的容器：App 侧只需 `<AboutSettings onBack={…} />`。
 *  链接由后台配置（GET /about-links，打开面板时刷新；拉取失败退回内置法务路径、隐藏客服行），
 *  走 platform.openExternal（浏览器新标签；桌面端交系统浏览器），不带任何凭据。 */
export function AboutSettings({ onBack }: { onBack: () => void }) {
  const t = useT();
  const { setToast, clientRef } = useAppServices();
  const links = useAboutLinks(() => clientRef.current?.authToken ?? "");
  const version = currentVersion();
  const open = (kind: AboutLinkKind) => {
    const url = resolveAboutLink(kind, links, getLang());
    if (!url) { setToast(t("about.open_failed")); return; }
    platform().openExternal(url);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(versionClipboardText(version));
      setToast(t("about.version_copied"));
    } catch {
      setToast(t("about.copy_failed")); // 剪贴板被拒（非安全上下文 / 权限）——不静默吞掉
    }
  };
  return <AboutPanel version={version} showCustomerService={resolveAboutLink("customerService", links, getLang()) !== null} onOpen={open} onCopyVersion={() => { void copy(); }} onBack={onBack} />;
}
