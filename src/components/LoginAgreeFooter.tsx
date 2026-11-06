import { Fragment } from "react";
import { getLang, tokenizeTemplate, useT } from "../i18n";
import { resolveAboutLink, type AboutLinkKind } from "../aboutLinks";
import { useAboutLinks } from "../useAboutLinks";
import { platform } from "../platform";

/**
 * 登录/注册页底部隐式同意提示（ABOUT_LEGAL_DESIGN 批②）：点「登录/注册」即视为同意，**无勾选框**。
 * 文案 `about.agree_footer` 带 `{terms}`/`{privacy}` 两个占位，用 `tokenizeTemplate` 切开后把这两段渲染成可点链接
 * （文案复用 `about.terms` / `about.privacy_policy`，与「关于我们」页一致）。
 * 链接取后台配置（匿名拉 GET /about-links，失败退回内置路径），走 `platform().openExternal`
 * （浏览器新标签 / 桌面交系统浏览器），不带任何凭据。
 */
export function LoginAgreeFooter() {
  const tr = useT();
  const links = useAboutLinks(() => "");
  const open = (kind: AboutLinkKind) => {
    const url = resolveAboutLink(kind, links, getLang());
    if (url) platform().openExternal(url);
  };
  const linkKind = (name: string): AboutLinkKind => (name === "terms" ? "terms" : "privacy");
  const linkLabel = (name: string) => tr(name === "terms" ? "about.terms" : "about.privacy_policy");
  // 不传 args：占位符原样保留，交给 tokenizeTemplate 定位哪两段要挂点击。
  return (
    <p className="login-agree">
      {tokenizeTemplate(tr("about.agree_footer")).map((tok, i) =>
        tok.type === "text" ? (
          <Fragment key={i}>{tok.value}</Fragment>
        ) : (
          <button key={i} type="button" className="login-agree-link" onClick={() => open(linkKind(tok.name))}>
            {linkLabel(tok.name)}
          </button>
        ),
      )}
    </p>
  );
}
