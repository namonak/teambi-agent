#!/usr/bin/env bash
set -euo pipefail

app_id="$(sed -n 's/^MicrosoftAppId=//p' .env | head -n 1 | tr -d '\r')"
[ -n "$app_id" ] || { echo '.env의 MicrosoftAppId가 필요합니다.' >&2; exit 1; }

stamp="$(TZ=Asia/Seoul date '+%Y%m%d-%H%M%S')"
archive="dist/teambi-agent-$stamp.zip"
package_dir="$(mktemp -d)"
trap 'rm -rf "$package_dir"' EXIT

mkdir -p dist
sed "s/{{MICROSOFT_APP_ID}}/$app_id/g" appPackage/manifest.json > "$package_dir/manifest.json"
zip -q -j "$archive" "$package_dir/manifest.json" appPackage/color.png appPackage/outline.png
zip -T "$archive" >/dev/null
printf 'Teams 앱 패키지: %s\n' "$archive"
