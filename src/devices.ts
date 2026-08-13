// 已登录设备（多设备管理 P2）纯展示逻辑：平台图标、设备名兜底、在线/最近活跃副标题。
// 语义（列表/在线态/踢下线）全在服务端；本模块只把 DeviceView 映射成一行的图标与两行文本，纯函数可单测。
import type { DeviceView } from "./sdk/protocol";

/** 平台 → 行首 emoji 图标。未知平台回退通用终端图标。 */
export function platformIcon(platform: string): string {
  switch (platform) {
    case "ios":
      return "📱";
    case "android":
      return "🤖";
    case "web":
      return "💻";
    case "desktop":
      return "🖥";
    default:
      return "📟";
  }
}

/** 设备显示名：优先服务端 device_name，缺省按平台兜底（避免空行）。 */
export function deviceName(d: DeviceView): string {
  if (d.device_name && d.device_name.trim()) return d.device_name.trim();
  switch (d.platform) {
    case "ios":
      return "iOS 设备";
    case "android":
      return "Android 设备";
    case "web":
      return "网页版";
    case "desktop":
      return "桌面版";
    default:
      return "未知设备";
  }
}

/** 相对时间（活跃度用）：刚刚 / N 分钟前 / N 小时前 / N 天前 / 具体日期。ms 为 0 视为从未。 */
export function relativeTime(ms: number, now: number): string {
  if (!ms) return "从未";
  const diff = now - ms;
  const MIN = 60_000, HR = 3_600_000, DAY = 86_400_000;
  if (diff < MIN) return "刚刚";
  if (diff < HR) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 设备副标题：在线→「在线 · 刚刚 · 位置 · IP」；离线→「N 小时前活跃 · 位置」。缺字段自动省略。 */
export function deviceSubtitle(d: DeviceView, now: number): string {
  const rel = relativeTime(d.last_active_at, now);
  const bits: string[] = [d.online ? "在线" : `${rel}活跃`];
  if (d.online) bits.push(rel);
  if (d.login_loc && d.login_loc.trim()) bits.push(d.login_loc.trim());
  if (d.online && d.login_ip && d.login_ip.trim()) bits.push(d.login_ip.trim());
  return bits.join(" · ");
}
