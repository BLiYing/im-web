import { useEffect, useState } from "react";
import { SYSTEM_UID } from "../sdk/protocol";
import { useT } from "../i18n";

// 可复用头像组件与首字母底色算法。从 App.tsx 抽出（纯展示，无业务依赖）。

/** 首字母头像的底色板（与 iOS IMTheme avatarColorForSeed 同一组 6 色：蓝/绿/橙/红/紫/青）。 */
const AVATAR_COLORS = ["#3399F5", "#4FC778", "#F59E33", "#E65C6B", "#9473E6", "#2EB8BD"];

type Segmenter = { segment(input: string): Iterable<{ segment: string }> };
/** 模块级缓存一个实例——`avatarInitial` 在头像渲染路径上几乎每次 re-render 都会调用，
 *  不必每次都 `new Intl.Segmenter(...)`（构造本身不便宜，输入又只有几个字）。 */
const segmenter: Segmenter | null = (() => {
  const Seg = (Intl as unknown as { Segmenter?: new (locale?: string, opts?: { granularity: string }) => Segmenter })
    .Segmenter;
  return Seg ? new Seg(undefined, { granularity: "grapheme" }) : null;
})();

/** 按「字形簇」切字符串（处理代理对表示的辅助平面字符，如扩展区汉字/emoji），不按字形簇组合标记细分也够用。
 *  `Intl.Segmenter` 不可用的环境（极老浏览器）回退到按 code point 切（`Array.from` 天然按 UTF-16 代理对聚合）。 */
function graphemes(s: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(s), (x) => x.segment);
  return Array.from(s);
}

/** CJK 统一表意文字：基本区 + 兼容区 + 全部辅助平面扩展区（B 起，含 C/D/E/F/G…，该平面几乎全部留给 CJK 扩展）。 */
function isHanCodePoint(cp: number): boolean {
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x3fffd);
}

/**
 * 头像回退用的首字母（2026-10-01 改，三端同口径，见 `../IMServer/docs/UI.md`「图标与头像资源」）：
 * 末一个字是汉字就取它（中文名去姓留名）；否则取首字母并转大写（英文名/用户名）。
 */
export function avatarInitial(name: string): string {
  const t = name.trim();
  if (!t) return "";
  const g = graphemes(t);
  const last = g[g.length - 1];
  if (isHanCodePoint(last.codePointAt(0) ?? 0)) return last;
  return g[0].toUpperCase();
}
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
  const tr = useT();
  // 头像 <img> 加载失败（多为 avatar_url 指向的 /uploads 文件已被服务端清理/删除 → 404）时，
  // 回退首字母色圈，与 iOS 一致；否则浏览器会画自带的「破图问号」。url 变更（换头像/切账号）后重试。
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  // 系统通知会话（seed=system）：头像走应用 logo（/im-logo.png）——服务端 avatar_url 恒空。
  // 见 docs/design/SYSTEM_NOTICE_SESSION_DESIGN.md §2.1。
  if (seed === SYSTEM_UID) { // 系统账号回退渲染应用 logo
    return (
      <div className={cls} onClick={onClick} role={onClick ? "button" : undefined}
           style={{ ...(onClick ? { cursor: "pointer" } : null), background: "#fff" }}>
        <img className="avatar-img" src="/im-logo.png" alt={tr("common.system_notice")} />
        {children}
      </div>
    );
  }
  const showImg = !!url && !failed;
  const bg = showImg ? undefined : avatarColor(seed ?? label);
  return (
    <div className={cls} onClick={onClick} role={onClick ? "button" : undefined}
         style={{ ...(onClick ? { cursor: "pointer" } : null), ...(bg ? { background: bg } : null) }}>
      {showImg ? <img className="avatar-img" src={url} alt="" onError={() => setFailed(true)} /> : avatarInitial(label || "")}
      {children}
    </div>
  );
}
