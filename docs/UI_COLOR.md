# im-web UI 配色与外观规范

> 本文由 iOS 的 `../IMProgram/docs/UI_COLOR.md` 同步并按 Web 平台适配，是 im-web
> 新增和修改 UI 的强制约束。CSS 变量是颜色、间距和圆角的唯一入口；用户外观偏好由
> React 状态统一写入 `document.documentElement.dataset.theme`，业务组件不得自行维护另一套主题。

## 1. 基本原则

- 使用语义令牌，禁止在页面和组件中散落 RGB、Hex 或固定黑白色。
- 浅色、深色、跟随系统三种模式必须共用同一套变量名，只替换变量值。
- 用户外观偏好保存在本机，退出登录后保留；切换后当前页面必须立即刷新。
- 白色只用于确定的深色底图标、头像文字和媒体遮罩；黑色只用于遮罩和阴影。
- 颜色透明变体也必须成为语义令牌，禁止在组件中重复写 `rgba(...)`。
- CSS 自定义属性必须在 `:root` 声明，不得依赖 `var(--name, 临时颜色)` 长期兜底。

## 2. iOS 与 Web 语义令牌映射

| 场景 | iOS | Web CSS 变量 | 规则 |
|---|---|---|---|
| 品牌操作、链接、选中态 | `IMTheme.accent` | `--accent` | 随聊天主题变化 |
| 普通页面背景 | `IMTheme.pageBackground` | `--page-bg` | 聊天正文以外的普通内容 |
| 分组页面背景 | `IMTheme.groupedBackground` | `--grouped-bg` | 设置、表单、详情抽屉 |
| 分组卡片背景 | `IMTheme.cardBackground` | `--card-bg` | 浅色白、深色深灰，始终与分组页区分 |
| 输入栏、附件面板 | `IMTheme.surface` | `--surface` | 一级表面 |
| 菜单、浮层、嵌套卡片 | `IMTheme.surfaceElevated` | `--surface-elevated` | 不连续叠加超过两层 |
| 标题、正文 | `IMTheme.textPrimary` | `--text` | 最高可读性 |
| 副标题、时间、说明 | `IMTheme.textSecondary` | `--text-secondary` | 不承载关键操作 |
| 占位、禁用辅助文字 | `IMTheme.textTertiary` | `--text-tertiary` | 禁止用于正文 |
| 分割线 | `IMTheme.separator` | `--separator` | 统一 1 CSS px |
| 删除、退出、失败 | `IMTheme.danger` | `--danger` | 不随聊天主题变化 |
| 未读徽标 | `IMTheme.unreadBadge` | `--unread-badge` | 固定蓝色 |
| 在线状态 | — | `--online` | 不与未读蓝、已读绿混用 |
| 文字链接 | — | `--link` | 默认跟随强调色，确需区分时单独定义 |
| Hover/选中表面 | — | `--surface-hover` / `--selection-bg` | 深浅色分别提供 |
| 遮罩、阴影 | — | `--overlay` / `--shadow` | 仅用于浮层和媒体 |

现有 `--bg`、`--line`、`--badge` 可在迁移期间作为
`--grouped-bg`、`--separator`、`--unread-badge` 的兼容别名；新代码不得继续引用这些旧名字。

## 3. 标题栏与导航

- 页面标题使用 20 px Semibold；抽屉/子页标题使用 17 px Semibold。
- 返回、保存、普通操作使用 `--accent`；危险操作使用 `--danger`。
- 标题栏使用 `--page-bg`，分割线只能使用 `--separator`。
- 媒体上的白色按钮必须有 `--overlay` 或阴影承托，确保明暗图片上都可见。

## 4. 文本层级

- 页面大标题：20 px Semibold。
- 导航和抽屉标题：17 px Semibold。
- 列表主标题：16～17 px Regular/Semibold。
- 列表副标题：13～15 px，`--text-secondary`。
- 聊天正文：`--msg-font`，允许用户在 14～22 px 调整。
- 时间、状态、辅助标签：11～13 px。
- 文本必须允许自然换行或省略，字号变化后禁止依赖固定高度。

## 5. 页面、卡片与输入

- 设置和详情页使用 `--grouped-bg`；其中卡片使用 `--card-bg`。
- 页面左右边距默认 16 px；同级卡片间距至少 12 px。外观设置中心的主题颜色、显示模式、
  聊天外观应各自使用独立卡片，卡片之间至少 24 px。
- 分组标题与对应卡片左边缘对齐。
- 卡片圆角使用 `--radius-card`，不得在相同层级混用多个任意圆角。
- 输入区使用 `--surface`，输入框使用 `--page-bg`，边框使用 `--separator`。
- 菜单、Popover、Modal 使用 `--surface-elevated`，不可与页面卡片共用同一层级色。
- 空状态居中，正文使用 `--text-secondary`，主操作使用 `--accent`。

## 6. 聊天个性化

- 聊天主题控制 `--accent`、`--bubble-me`、壁纸色组；对方气泡保持中性动态色。
- 自己和对方气泡圆角使用 `--radius-bubble`，正文使用 `--msg-font`。
- 聊天壁纸必须由应用根节点的唯一背景层渲染，处于会话、聊天和资料卡片之下；禁止页面自行复制
  壁纸层。桌面布局使用同一个 `--app-gap` 作为屏幕外边距、左右栏间距和聊天/资料间距。
- 背景模糊只允许作用于根壁纸层，不得模糊消息、输入栏、设置页或资料卡片。
- 左会话卡片与右资料卡片使用相同宽度和高度；聊天标题必须包含会话头像、主标题和状态/群成员数副标题。
- 所有圆形头像使用 `--avatar-ring` 外框，确保照片或回退色与卡片背景之间有清晰边界。
- 壁纸、气泡、引用、译文和系统提示必须同时提供浅色与深色值。
- 内置壁纸本身属于视觉素材，允许在集中式壁纸目录中定义自身渐变色；这些色值不得用于
  按钮、文字、页面或其他业务组件。
- 主题、壁纸、字号、圆角不得只用文本或单选框表达；实现 Web 外观中心时须提供真实聊天预览。
- Web 不支持像 iOS 一样切换系统应用图标；PWA 图标只能由 manifest/打包资源决定。

## 7. 深色模式验收

- 分别检查 `light`、`dark`、`system + prefers-color-scheme: dark`。
- 页面、卡片、浮层至少形成三个可辨识层级，不能融为同色。
- 标题、正文、按钮、输入框、分割线在两种外观中均可辨识。
- Hover、选中、禁用和危险态不得只在浅色模式可见。
- 切换主题后不得要求刷新页面或重新登录。

## 8. 新功能检查清单

1. 修改 UI 前读取本文。
2. 优先复用现有令牌；缺少语义时先补 `:root` 和全部深色分支。
3. 搜索新增代码中的 Hex、RGB、固定 `white/black`，确认仅用于允许的媒体/遮罩场景。
4. 检查变量是否已声明，禁止用 fallback 掩盖遗漏。
5. 对桌面双栏、窄屏单栏、浅色、深色和跟随系统各检查一次。
6. 更新本文或说明为什么无需新增规则。
