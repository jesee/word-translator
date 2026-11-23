#!/usr/bin/env bash
# 安装 GNOME 扩展到当前用户并启用
set -e
SRC="$(cd "$(dirname "$0")/word-translator@local" && pwd)"
DEST="$HOME/.local/share/gnome-shell/extensions/word-translator@local"

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -r "$SRC" "$DEST"

# 编译 gschema
glib-compile-schemas "$DEST/schemas/"

# 启用扩展
gnome-extensions enable word-translator@local || true

echo "已安装并启用。如果未生效，请按 Alt+F2 输入 r（仅 X11）或注销重新登录（Wayland）。"
echo "检查状态：gnome-extensions info word-translator@local"
