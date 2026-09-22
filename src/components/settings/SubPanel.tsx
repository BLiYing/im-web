import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useT } from "../../i18n";

/** 设置子面板通用外壳：settings-panel 容器 + settings-head（返回 + 标题 + 右槽）+ settings-body。
 *  right 不给时渲染占位 spacer 保持标题居中；各面板只写 body 内容。 */
export function SubPanel({ className, headClassName, bodyClassName, title, right, onBack, children }: {
  className?: string; // 追加到 settings-panel
  headClassName?: string; // 追加到 settings-head（如 wallpaper-head）
  bodyClassName?: string; // 追加到 settings-body
  title: string;
  right?: ReactNode; // 头部右侧按钮；不给则占位
  onBack: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className={`settings-panel${className ? ` ${className}` : ""}`}>
      <header className={`settings-head${headClassName ? ` ${headClassName}` : ""}`}>
        <button className="icon-btn" title={t("common.back")} onClick={onBack}><ChevronLeft size={27} /></button>
        <span className="settings-title">{title}</span>
        {right || <span className="icon-btn-spacer" />}
      </header>
      <div className={`settings-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>
        {children}
      </div>
    </div>
  );
}
