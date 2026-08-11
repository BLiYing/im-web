// 长文本消息的显示分档（与 iOS IMLongText 同口径，两端阈值必须一致）。
//   short — 气泡内全显（现状）
//   long  — 气泡内折叠前若干行 + 「展开全文 / 收起」就地展开
//   huge  — 气泡只留摘要卡，点开走全屏阅读器（可滚动/选中复制/字号）
// 判据用"字符数 + 行数"双条件，避免一行超长或多行短句被单一判据误判。

export type TextTier = "short" | "long" | "huge";

/** huge 门槛：≥2000 字符 或 ≥60 行。long 门槛：≥300 字符 或 ≥10 行。 */
export const HUGE_CHARS = 2000;
export const HUGE_LINES = 60;
export const LONG_CHARS = 300;
export const LONG_LINES = 10;
// 折叠态在气泡内保留的行数写死在 styles.css 的 `-webkit-line-clamp: 8`（此处不设常量，避免与 CSS 双份漂移）。

function lineCount(text: string): number {
  // 只数硬换行；软换行由渲染层的行夹（line-clamp/max-height）兜底。
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function textTier(content: string | null | undefined): TextTier {
  const text = content ?? "";
  // 快路径：UTF-16 长度已是码点数的上界，短且无换行必为 short——绝大多数消息走这里，
  // 免掉 `[...text]` 的整串码点展开（长列表每次渲染逐条调用，避免无谓分配）。
  if (text.length < LONG_CHARS && text.indexOf("\n") === -1) return "short";
  const chars = [...text].length; // 按码点计，避免 emoji/CJK 代理对虚高
  const lines = lineCount(text);
  if (chars >= HUGE_CHARS || lines >= HUGE_LINES) return "huge";
  if (chars >= LONG_CHARS || lines >= LONG_LINES) return "long";
  return "short";
}

/** 摘要卡上的字数标签，如 "约 8,400 字"。按码点计数并千分位。 */
export function charCountLabel(content: string | null | undefined): string {
  const chars = [...(content ?? "")].length;
  return `约 ${chars.toLocaleString("en-US")} 字`;
}
