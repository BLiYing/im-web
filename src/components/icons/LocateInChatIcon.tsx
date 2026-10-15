// 「定位到聊天位置」共用图标（PINNED_PANEL_DESIGN §8，草图 ⑦）：聊天气泡轮廓 + 气泡内斜向箭头（↗，「在聊天里打开这条」）。
// 24×24 viewBox、笔画 1.8、圆头圆角；无色图形，颜色靠 currentColor。路径即真相，三端同一份（iOS UIBezierPath / Android ImageVector）。
// 本期只在置顶面板使用；群资料 Tab 列表 / 媒体查看器 / 搜索结果等入口的替换放最后一期统一做。

export function LocateInChatIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      <path d="M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-6.2L8 20v-3.5H6A2.5 2.5 0 0 1 3.5 14V7A2.5 2.5 0 0 1 6 4.5z" />
      <path d="M9.5 13l5-5M10.5 8h4v4" />
    </svg>
  );
}
