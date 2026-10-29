// 个性签名的前端规整（PROFILE_BIO_DESIGN §2.2）：上限按 Unicode 码点计（与服务端 profile.MaxBioRunes 同口径）。
export const MAX_BIO_RUNES = 70;
/** 计数达到此值变 danger 色。 */
export const BIO_WARN_RUNES = 60;

/** 码点数（emoji 代理对算一个；Array.from 按码点迭代）。 */
export function bioRunes(s: string): number {
  return Array.from(s).length;
}

/** 输入时的实时规整：换行折成空格（签名是单段文字）、超长按码点截断（粘贴超长不拒绝整次输入）。 */
export function clampBio(s: string): string {
  const flat = s.replace(/[\r\n]+/g, " ");
  const runes = Array.from(flat);
  return runes.length <= MAX_BIO_RUNES ? flat : runes.slice(0, MAX_BIO_RUNES).join("");
}
