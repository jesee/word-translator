#!/usr/bin/env bash
# 安装 GNOME 扩展到当前用户并启用
set -e
SRC="$(cd "$(dirname "$0")/word-translator@local" && pwd)"
DEST="$HOME/.local/share/gnome-shell/extensions/word-translator@local"

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -r "$SRC" "$DEST"
rm -f "$DEST/gschemas.compiled"

# 编译 gschema（上传用的 zip 里不带编译产物，本地安装必须自己编）
glib-compile-schemas "$DEST/schemas/"

# 出厂不带默认快捷键（审核要求），开发机这里补一个，省得每次重装后再去设置里点一遍
SCHEMA="org.gnome.shell.extensions.word-translator"
if [ -z "$(gsettings --schemadir "$DEST/schemas" get "$SCHEMA" translate-shortcut | tr -d "[]', ")" ]; then
  gsettings --schemadir "$DEST/schemas" set "$SCHEMA" translate-shortcut "['<Alt><Super>x']"
  echo "已设置默认快捷键 <Alt><Super>x（可随时在扩展设置里改）"
fi

# 启用扩展
gnome-extensions enable word-translator@local || true

echo "已安装并启用。如果未生效，请按 Alt+F2 输入 r（仅 X11）或注销重新登录（Wayland）。"
echo "检查状态：gnome-extensions info word-translator@local"
