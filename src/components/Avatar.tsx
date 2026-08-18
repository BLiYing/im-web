import { useEffect, useState } from "react";

// 可复用头像组件与首字母底色算法。从 App.tsx 抽出（纯展示，无业务依赖）。

/** 首字母头像的底色板（与 iOS IMTheme avatarColorForSeed 同一组 6 色：蓝/绿/橙/红/紫/青）。 */
const AVATAR_COLORS = ["#3399F5", "#4FC778", "#F59E33", "#E65C6B", "#9473E6", "#2EB8BD"];
/** 按种子（uid / 群 conv_id）稳定取底色，与 iOS 同算法：h = h*31 + UTF-16 码元、64 位无符号回绕、% 6。
 *  同一 uid 两端同色。用 BigInt 精确复刻 NSUInteger 的 2^64 回绕（短 uid 无溢出，长种子也不偏差）。 */
export function avatarColor(seed: string): string {
  if (!seed) return AVATAR_COLORS[0];
  const MASK = (1n << 64n) - 1n;
  let h = 0n;
  for (let i = 0; i < seed.length; i++) h = (h * 31n + BigInt(seed.charCodeAt(i))) & MASK;
  return AVATAR_COLORS[Number(h % 6n)];
}

// cls 决定尺寸（avatar / settings-avatar / edit-avatar）；children 作为叠加层（如在线点、相机角标）。
// 可复用头像：有 avatar_url → 渲染 <img>；否则回退首字母圈，底色按 seed（uid/群 conv_id）播种（与 iOS 同色）。
// seed 缺省回落 label——但 label 是昵称、会变且与 iOS 的 uid 种子不一致，故用户头像务必显式传 uid。
export function Avatar({ url, label, seed, cls = "avatar", children, onClick }: {
  url?: string; label: string; seed?: string; cls?: string; children?: React.ReactNode; onClick?: () => void;
}) {
  // 头像 <img> 加载失败（多为 avatar_url 指向的 /uploads 文件已被服务端清理/删除 → 404）时，
  // 回退首字母色圈，与 iOS 一致；否则浏览器会画自带的「破图问号」。url 变更（换头像/切账号）后重试。
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  const showImg = !!url && !failed;
  const bg = showImg ? undefined : avatarColor(seed ?? label);
  return (
    <div className={cls} onClick={onClick} role={onClick ? "button" : undefined}
         style={{ ...(onClick ? { cursor: "pointer" } : null), ...(bg ? { background: bg } : null) }}>
      {showImg ? <img className="avatar-img" src={url} alt="" onError={() => setFailed(true)} /> : (label || "").slice(-2)}
      {children}
    </div>
  );
}
