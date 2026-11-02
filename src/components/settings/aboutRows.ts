// 设置页「关于我们」入口组（单行）。拆出独立文件只为守 App.tsx 体量红线。
import { Info } from "lucide-react";
import type { Row } from "../rows";
import { openAboutPanel } from "../../aboutUi";

export const aboutRows = (t: (key: string) => string): Row[] => [
  { id: "about", label: t("about.title"), icon: Info, iconTint: "gray", chevron: true, onClick: openAboutPanel },
];
