#!/bin/sh
# electron-packager 用 --app-bundle-id 生成 Info.plist，但不提供显示名的选项。
# 这里在打包后写入 CFBundleName 和 CFBundleDisplayName，让菜单栏和 Dock 显示产品名。
set -eu
cd "$(dirname "$0")/.."
name=${APP_DISPLAY_NAME:-Wick}
plist="${WICK_BUILD_OUT:-dist}/Wick-darwin-arm64/Wick.app/Contents/Info.plist"
[ -f "$plist" ] || { printf 'Missing %s\n' "$plist" >&2; exit 1; }
/usr/bin/plutil -replace CFBundleName -string "$name" "$plist"
/usr/bin/plutil -replace CFBundleDisplayName -string "$name" "$plist"
/usr/bin/plutil -lint "$plist" >/dev/null
printf 'Set display name to %s\n' "$name"
