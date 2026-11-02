import { Fragment } from "react";
import { getLang, tokenizeTemplate, useT } from "../i18n";
import { LEGAL_PATH, legalUrl } from "../aboutLinks";
import { platform } from "../platform";

/**
 * 登录/注册页底部隐式同意提示（ABOUT_LEGAL_DESIGN 批②）：点「登录/注册」即视为同意，**无勾选框**。
 * 文案 `about.agree_footer` 带 `{terms}`/`{privacy}` 两个占位，用 `tokenizeTemplate` 切开后把这两段渲染成可点链接
 * （文案复用 `about.terms` / `about.privacy_policy`，与「关于我们」页一致）。
 * 链接走 `platform().openExternal`（浏览器新标签 / 桌面交系统浏览器），法务页是公开静态页、不带任何凭据。
 */
export function LoginAgreeFooter() {
  const tr = useT();
  const open = (path: string) => {
    const url = legalUrl(path, getLang());
    if (url) platform().openExternal(url);
  };
  const linkPath = (name: string) => (name === "terms" ? LEGAL_PATH.terms : LEGAL_PATH.privacy);
  const linkLabel = (name: string) => tr(name === "terms" ? "about.terms" : "about.privacy_policy");
  // 不传 args：占位符原样保留，交给 tokenizeTemplate 定位哪两段要挂点击。
  return (
    <p className="login-agree">
      {tokenizeTemplate(tr("about.agree_footer")).map((tok, i) =>
        tok.type === "text" ? (
          <Fragment key={i}>{tok.value}</Fragment>
        ) : (
          <button key={i} type="button" className="login-agree-link" onClick={() => open(linkPath(tok.name))}>
            {linkLabel(tok.name)}
          </button>
        ),
      )}
    </p>
  );
}
