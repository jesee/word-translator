#!/usr/bin/env bash
# 打包成 extensions.gnome.org 可上传的 zip
#
#   ./ext/package.sh                          # 打 word-translator@local.zip
#   UUID=word-translator@you.github.io ./ext/package.sh   # 换个 uuid 再打
#   VERSION=1.1.0 ./ext/package.sh            # 升版本（写进 version-name，用户可见）
#   URL=https://github.com/you/word-translator ./ext/package.sh   # 换项目主页
#
# 规则（extensions.gnome.org 上传页要求 + 审核指南）：
#   1. metadata.json 必须在 zip 根目录，不能套一层目录
#   2. 只放运行时文件：extension.js / prefs.js / metadata.json / schemas/*.gschema.xml
#   3. 不要带 gschemas.compiled、install 脚本、po、图标等多余文件（审核会报 EGO-P-006）
#   4. schemas 目录名和 <schema-id>.gschema.xml 文件名必须原样保留
set -euo pipefail

UUID="${UUID:-word-translator@local}"
VERSION="${VERSION:-}"
URL="${URL:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/word-translator@local"
OUT_DIR="$HERE/dist"
ZIP="$OUT_DIR/$UUID.zip"

[ -f "$SRC/metadata.json" ] || { echo "找不到 $SRC/metadata.json" >&2; exit 1; }
command -v zip >/dev/null || { echo "缺 zip：sudo apt install zip" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# 1) 只挑运行时文件
cp "$SRC/metadata.json" "$SRC/extension.js" "$SRC/prefs.js" "$STAGE/"
[ -f "$SRC/stylesheet.css" ] && cp "$SRC/stylesheet.css" "$STAGE/"
[ -f "$HERE/../LICENSE" ] && cp "$HERE/../LICENSE" "$STAGE/"
mkdir -p "$STAGE/schemas"
cp "$SRC"/schemas/*.gschema.xml "$STAGE/schemas/"
find "$STAGE" -name 'gschemas.compiled' -delete

# 2) 需要时改写 uuid（审核通常要求 namespace 是域名/账号，而不是 local）
if [ "$UUID" != "$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$STAGE/metadata.json")" ]; then
  sed -i "s/\"uuid\": *\"[^\"]*\"/\"uuid\": \"$UUID\"/" "$STAGE/metadata.json"
fi

# 2.5) 需要时改项目主页（eGO 要求 metadata 里有 url）
if [ -n "$URL" ]; then
  python3 - "$STAGE/metadata.json" "$URL" <<'PY'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
m = json.loads(p.read_text())
m['url'] = sys.argv[2].rstrip('/')
p.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
PY
  echo "==> url = $URL"
fi

# 3) 需要时改版本名（version 是 eGO 控制的提交号，version-name 才是用户看到的版本）
if [ -n "$VERSION" ]; then
  python3 - "$STAGE/metadata.json" "$VERSION" <<'PY'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
m = json.loads(p.read_text())
m['version-name'] = sys.argv[2]
p.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
PY
  echo "==> version-name = $VERSION"
fi

# 4) 打平打 zip：文件直接躺在根目录
mkdir -p "$OUT_DIR"
rm -f "$ZIP"
FILES=(metadata.json extension.js prefs.js)
[ -f "$STAGE/stylesheet.css" ] && FILES+=(stylesheet.css)
[ -f "$STAGE/LICENSE" ] && FILES+=(LICENSE)
FILES+=("schemas/$(basename "$(ls "$STAGE"/schemas/*.gschema.xml | head -1)")")
( cd "$STAGE" && zip -X -9 -q "$ZIP" "${FILES[@]}" )

echo "==> $ZIP ($(du -h "$ZIP" | cut -f1))"
unzip -l "$ZIP" | sed -n '3,20p'
echo
echo "==> metadata.json:"
cat "$STAGE/metadata.json"

# 4) 用官方审核工具自检（自动装在 .venv-shexli 里，没有就跳过）
SHEX="${SHEXLI:-}"
if [ -z "$SHEX" ] && command -v shexli >/dev/null; then SHEX="$(command -v shexli)"; fi
if [ -z "$SHEX" ] && [ -x "$HERE/.venv-shexli/bin/shexli" ]; then SHEX="$HERE/.venv-shexli/bin/shexli"; fi
if [ -n "$SHEX" ]; then
  echo
  "$SHEX" "$ZIP" || true
else
  echo
  echo "（未找到 shexli，跳过自检。装一下：python3 -m venv \"$HERE/.venv-shexli\" && \"$HERE/.venv-shexli/bin/pip\" install -U shexli tree-sitter==0.25.2）"
fi
