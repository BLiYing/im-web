// 「关于我们」链接配置（后台可配）。后端：IMServer/cmd/imserver/handlers_aboutlinks.go。
//
// 无需登录：登录页底部的隐私政策/服务条款要在登录前取到。带有效 token 才会返回 customer_service_url，
// 匿名时该字段为空串。token 传 "" 即匿名（不带 Authorization 头）。

import { callJson } from "./http";
import type { AboutLinksData } from "../aboutLinks";

export function fetchAboutLinks(token: string): Promise<AboutLinksData> {
  return callJson("/api/v1/about-links", token ? { headers: { Authorization: `Bearer ${token}` } } : undefined) as Promise<AboutLinksData>;
}
