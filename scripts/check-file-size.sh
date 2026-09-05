#!/usr/bin/env bash
# check-file-size.sh —— 防巨组件体检：单文件行数超阈值即失败（im-web / React+TS）。
#
#   用法（仓库根目录）：  ./scripts/check-file-size.sh
#   接入：提交前钩子 / CI / build 之前调用；退出码 1 = 有文件超预算。
#
# 设计：阈值定得「现在能过、复胖会响」。真正超标的历史欠账登记在 GRANDFATHER，
# 上限=当前行数留少量余量——**只准降不准升**；要动它请拆分，别往里加。降到 MAX 以下后从表里删。
#
# 超标的正确处理是**拆分**，不是放宽阈值（详见 CODING_STYLE.md §7）：
#   ① 有自己状态/生命周期的一簇逻辑 → 自定义 Hook（use*.ts，参考 useDevices/useDialogs/useToast）
#   ② 一整块 UI（面板/弹窗/查看器）  → 独立展示组件（components/**，props 注入，参考 SettingsPanel/MediaViewer）
#   ③ 纯逻辑（无 React）             → *.ts 纯函数模块 + 单测（参考 messageContent/wallpaper/color）
set -u

MAX_LINES=${MAX_LINES:-600}           # 未登记文件行数上限（可用环境变量覆盖，便于调参）
WARN_RATIO=${WARN_RATIO:-80}          # 达上限该比例即预警（不失败），尽早规划拆分

# 历史欠账（已超 MAX_LINES、待拆分）。值 = 当前行数 + 少量余量，**只准降不准升**。
#   - src/App.tsx      : 应用外壳，2026-08 系统性拆分至 ~3000（6302 → 4891 → 2960±：9 阶段抽 MessageList/DetailPanel/Composer/ContactsTab/ChatHeader + useChatSearch/useMediaDownload/useMediaSend/useForward/useFavorites/useMentions/useQR/useAppearanceSettings/useFriendOps/useProfileEdit）。
#                        2026-09-05 再抽一轮 3995 → 3735：chatNaming（显示名/头像解析，纯工厂 + 13 例）、
#                        convPreview（会话预览，纯函数 + 9 例）、useGroupOps（群写操作 + 它们自己的 7 个弹窗 state）。
#                        剩余=核心 state/连接/滚动核心/菜单表/enterApp 等胶水（§7 不硬抽），见 current_task.md。
#                        **这个数字不是给 App.tsx 留的成长空间**：新功能按 §7 决策树进新文件，触顶就是提醒该开新文件了。
#   - src/sdk/imSdk.ts : IM 客户端 API 面（40+ 方法），大而由业务性质决定；如拆按域分（auth/messages/groups/qr）。
grandfather_limit() {
  case "$1" in
    src/App.tsx)      echo 3790 ;;  # 2026-09-05 棘轮 4000→3800→3790（jumpToSeq 的 DOM 部分抽到 messageJump.ts 后 3776）。
                                    # 4000 那次是「触顶挡了 bug fix→用户拍板放宽」，不是设计值；现在有余量了就收回来。
    src/sdk/imSdk.ts) echo 1445 ;;  # 2026-09-05 1465→1445：帧→ChatMessage 的解析抽到 sdk/parseMessage.ts（棘轮只降不升）
                                    # 已抽到 sdk/wake.ts，类里只剩 reconnectNow 这个接线口（连接活性本就是
                                    # 本类的职责，再往外拆就是为凑数字硬拆，见 CLAUDE.md 体量红线那条）。
    *)                echo "" ;;
  esac
}

cd "$(dirname "$0")/.." || { echo "无法定位仓库根目录"; exit 2; }

fail=0
warn=0

echo "== 单文件行数体检（默认上限 ${MAX_LINES}；历史欠账见脚本内 GRANDFATHER；不含 *.test.*）=="
while IFS= read -r f; do
  lines=$(wc -l < "$f" | tr -d ' ')
  gf=$(grandfather_limit "$f")
  if [ -n "$gf" ]; then limit=$gf; tag=" [欠账·待拆]"; else limit=$MAX_LINES; tag=""; fi
  if [ "$lines" -gt "$limit" ]; then
    echo "  ✗ FAIL  ${f}  ${lines} 行 > ${limit}${tag}"
    fail=1
  else
    warn_at=$(( limit * WARN_RATIO / 100 ))
    if [ "$lines" -ge "$warn_at" ]; then
      echo "  ⚠ WARN  ${f}  ${lines} 行（≥ ${warn_at}，接近上限 ${limit}）${tag}"
      warn=1
    fi
  fi
done < <(find src -type f \( -name "*.ts" -o -name "*.tsx" \) \
           ! -name "*.test.ts" ! -name "*.test.tsx" ! -name "*.d.ts" | sort)

echo ""
if [ "$fail" -ne 0 ]; then
  echo "结果：✗ 有文件超预算——请拆分（抽 Hook / 抽展示组件 / 抽纯函数模块 + 单测），见 CODING_STYLE.md §7，别放宽阈值。"
  exit 1
fi
[ "$warn" -ne 0 ] && echo "结果：✓ 通过（有 WARN——尽早规划拆分，勿等触顶）。" || echo "结果：✓ 全部通过。"
exit 0
