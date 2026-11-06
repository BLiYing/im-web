// 设置页「关于我们」入口组（单行）。拆出独立文件只为守 App.tsx 体量红线。
import { FileText, Headset, Info, LifeBuoy, ShieldCheck } from "lucide-react";
import type { AboutLinkKind } from "../../aboutLinks";
import type { Row } from "../rows";
import { openAboutPanel } from "../../aboutUi";

export const aboutRows = (t: (key: string) => string): Row[] => [
  { id: "about", label: t("about.title"), icon: Info, iconTint: "gray", chevron: true, onClick: openAboutPanel },
];

/** 「关于我们」二级页的行：隐私政策 / 服务条款 / 技术支持 /（有客服地址才有）在线客服 / 版本。纯函数，便于测顺序与显隐。 */
export function aboutPanelRows(t: (key: string) => string, o: {
  version: string;
  showCustomerService: boolean;
  onOpen: (kind: AboutLinkKind) => void;
  onCopyVersion: () => void;
}): Row[] {
  const link = (id: string, key: string, icon: Row["icon"], iconTint: string, kind: AboutLinkKind): Row =>
    ({ id, label: t(key), icon, iconTint, chevron: true, onClick: () => o.onOpen(kind) });
  return [
    link("about_privacy", "about.privacy_policy", ShieldCheck, "blue", "privacy"),
    link("about_terms", "about.terms", FileText, "gray", "terms"),
    link("about_support", "about.support", LifeBuoy, "green", "support"),
    ...(o.showCustomerService ? [link("about_customer_service", "about.customer_service", Headset, "orange", "customerService")] : []),
    { id: "about_version", label: t("about.version"), icon: Info, iconTint: "gray", value: o.version, onClick: o.onCopyVersion },
  ];
}
