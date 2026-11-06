// 取「关于我们」链接配置的 hook：挂载时拉一次（面板每次打开 = 一次挂载 = 刷新一次），
// 模块级缓存让再次打开时先用上次的结果、不闪。失败只记 warn、返回缓存/null，调用方按 null 回退内置链接。
import { useEffect, useState } from "react";
import type { AboutLinksData } from "./aboutLinks";
import { fetchAboutLinks } from "./sdk/aboutLinksApi";
import { LOG_TAG, logger } from "./logging/logger";

// 缓存按 token 分键（"" = 匿名）：客服地址是按用户下发的（带个人 ck），不能让上一个账号的结果串到下一个账号，
// 也不能让匿名结果盖掉登录态的。
const cache = new Map<string, AboutLinksData>();

/** getToken 返回 "" = 匿名（登录页）。只在挂载时调用一次。 */
export function useAboutLinks(getToken: () => string): AboutLinksData | null {
  const [links, setLinks] = useState<AboutLinksData | null>(() => cache.get(getToken()) ?? null);
  useEffect(() => {
    let alive = true;
    const token = getToken();
    fetchAboutLinks(token)
      .then((d) => { cache.set(token, d); if (alive) setLinks(d); })
      .catch((e: unknown) => {
        logger.warn(LOG_TAG.http, "about_links_fetch_failed", { error: e instanceof Error ? e.message : String(e) });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时拉一次
  }, []);
  return links;
}
