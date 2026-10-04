/**
 * 「我发的消息」已读状态图标（READ_TICK_DESIGN）：未读 = 单勾，已读 = 双勾。
 * 内联 SVG + currentColor，颜色全由调用方 className（ck / voice-tick / convck）决定。
 * 路径与 iOS / Android 同源：单勾 M1 5.2 L4.4 8.6 L12 1；双勾 = 再加右移 5 的一笔。
 */
interface ReadTickProps {
  read: boolean;
  /** 调用处原基础 class（ck / voice-tick / convck）；已读时自动追加 " read"，既有样式与选择器继续有效。 */
  className?: string;
}

export function ReadTick({ read, className }: ReadTickProps) {
  const cls = `${className ?? ""}${read ? " read" : ""} rtick`.trim();
  return (
    <span className={cls} aria-hidden="true">
      <svg
        viewBox={read ? "0 0 18 10" : "0 0 13 10"}
        fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round"
      >
        <path d="M1 5.2 L4.4 8.6 L12 1" />
        {read && <path d="M6 5.2 L9.4 8.6 L17 1" />}
      </svg>
    </span>
  );
}
