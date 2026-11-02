import { FileText, Info, LifeBuoy, ShieldCheck } from "lucide-react";
import { SubPanel } from "./SubPanel";
import { renderRow, type Row } from "../rows";
import { LEGAL_PATH, currentVersion, legalUrl, versionClipboardText } from "../../aboutLinks";
import { platform } from "../../platform";
import { useAppServices } from "../../AppServicesContext";
import { getLang, useT } from "../../i18n";

/** 关于我们（对齐 iOS IMAboutViewController / Android AboutScreen）：隐私政策 / 服务条款 / 技术支持 / 版本。
 *  纯展示：动作由容器注入。版本行无 chevron、有右值，点一下复制。 */
export function AboutPanel({ version, onOpen, onCopyVersion, onBack }: {
  version: string;
  onOpen: (path: string) => void;
  onCopyVersion: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const rows: Row[] = [
    { id: "about_privacy", label: t("about.privacy_policy"), icon: ShieldCheck, iconTint: "blue", chevron: true, onClick: () => onOpen(LEGAL_PATH.privacy) },
    { id: "about_terms", label: t("about.terms"), icon: FileText, iconTint: "gray", chevron: true, onClick: () => onOpen(LEGAL_PATH.terms) },
    { id: "about_support", label: t("about.support"), icon: LifeBuoy, iconTint: "green", chevron: true, onClick: () => onOpen(LEGAL_PATH.support) },
    { id: "about_version", label: t("about.version"), icon: Info, iconTint: "gray", value: version, onClick: onCopyVersion },
  ];
  return (
    <SubPanel className="about-panel" title={t("about.title")} onBack={onBack}>
      <div className="settings-group">{rows.map((r) => renderRow(r, "settings-row"))}</div>
    </SubPanel>
  );
}

/** 接好链接打开 / 复制 / 轻提示的容器：App 侧只需 `<AboutSettings onBack={…} />`。
 *  链接走 platform.openExternal（浏览器新标签；桌面端交系统浏览器），法务页是公开静态页，不带任何凭据。 */
export function AboutSettings({ onBack }: { onBack: () => void }) {
  const t = useT();
  const { setToast } = useAppServices();
  const version = currentVersion();
  const open = (path: string) => {
    const url = legalUrl(path, getLang());
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
  return <AboutPanel version={version} onOpen={open} onCopyVersion={() => { void copy(); }} onBack={onBack} />;
}
