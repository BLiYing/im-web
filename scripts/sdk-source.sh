#!/usr/bin/env bash
# 切换 im-rtc SDK 的来源（两个包：im-rtc-call-engine / im-rtc-call-uikit-react）。
#
#   ./scripts/sdk-source.sh npm [版本]   默认。用 npm 正式版（默认 2.0.0）。
#   ./scripts/sdk-source.sh local        本地包：改成 file:../im-rtc/im-rtc-web/.sdk-release/local/tgz/*.tgz
#                                        （先在 im-rtc-web 跑 `./scripts/pack-sdk.sh local`；改了 SDK 源码要重新打包再跑本脚本）
#
# 用途：验尚未发布的 SDK 改动时切 local；验完切回 npm。
# 注意：会改 package.json 与 package-lock.json——切到 local 期间**不要提交这两个文件**。
# 装完要 `npx vite --force`（Vite 预打包缓存仍是旧包，见 im-rtc 记忆「重装 tgz 要 vite --force」）。
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-}"
LOCAL_DIR="../im-rtc/im-rtc-web/.sdk-release/local/tgz"

case "$MODE" in
  npm)
    VER="${2:-2.0.0}"
    npm install --save-exact "im-rtc-call-engine@${VER}" "im-rtc-call-uikit-react@${VER}"
    ;;
  local)
    # 版本取 im-rtc-web 的 SDK_VERSION，tgz 文件名 = <包名>-<版本>.tgz
    VER="$(sed -n "s/.*SDK_VERSION *= *['\"]\([0-9.]*\)['\"].*/\1/p" ../im-rtc/im-rtc-web/packages/call-engine/src/version.ts | head -1)"
    [ -n "$VER" ] || { echo "读不到 im-rtc-web 的 SDK_VERSION" >&2; exit 1; }
    E="$LOCAL_DIR/im-rtc-call-engine-${VER}.tgz"; U="$LOCAL_DIR/im-rtc-call-uikit-react-${VER}.tgz"
    [ -f "$E" ] && [ -f "$U" ] || { echo "缺本地 tgz：先在 im-rtc-web 跑 ./scripts/pack-sdk.sh local" >&2; exit 1; }
    # 本地 tgz 每次重打包哈希都变，lock 里旧的 integrity 会不符，先清掉这两个包再装
    rm -rf node_modules/im-rtc-call-engine node_modules/im-rtc-call-uikit-react
    npm install --no-save=false "file:$E" "file:$U" || {
      echo "integrity 不符时：删 package-lock.json 里这两个包的 integrity 行后重试" >&2; exit 1; }
    ;;
  *)
    sed -n '2,10p' "$0"; exit 2 ;;
esac
echo "SDK 来源：${MODE}（$(grep '"version"' node_modules/im-rtc-call-engine/package.json | tr -d ' ,')）——记得 npx vite --force 重启"
