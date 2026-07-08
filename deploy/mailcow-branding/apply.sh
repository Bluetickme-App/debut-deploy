#!/usr/bin/env bash
# Re-apply DebutDeploy webmail branding to a mailcow box.
# Usage: KEY=/path/to/mailcow_key ./apply.sh <box-ip>
set -euo pipefail
HOST="${1:?usage: KEY=... ./apply.sh <box-ip>}"
KEY="${KEY:?set KEY=/path/to/mailcow_key}"
DIR="$(cd "$(dirname "$0")" && pwd)"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new root@$HOST"
MC=/opt/mailcow-dockerized

# 1. SOGo files (inbox theme + logos) + mailcow login accent CSS
scp -i "$KEY" -q "$DIR"/custom-sogo.js "$DIR"/custom-fulllogo.svg "$DIR"/custom-shortlogo.svg "$DIR"/custom-fulllogo-dark.svg "root@$HOST:$MC/data/conf/sogo/"
scp -i "$KEY" -q "$DIR"/0081-custom-mailcow.css "root@$HOST:$MC/data/web/css/build/0081-custom-mailcow.css"

# 2. mailcow login logo + names (Redis keys, same as the Customize UI writes)
$SSH "cd $MC && source mailcow.conf && \
  scp_light() { :; }; \
  R() { docker compose exec -T redis-mailcow redis-cli -a \"\$REDISPASS\" \"\$@\" >/dev/null 2>&1; }; \
  L=\"data:image/svg+xml;base64,\$(base64 -w0 $MC/data/conf/sogo/custom-fulllogo.svg)\"; \
  D=\"data:image/svg+xml;base64,\$(base64 -w0 $MC/data/conf/sogo/custom-fulllogo-dark.svg)\"; \
  R SET MAIN_LOGO \"\$L\"; R SET MAIN_LOGO_DARK \"\$D\"; \
  R SET TITLE_NAME 'DebutDeploy Mail'; R SET MAIN_NAME 'DebutDeploy Mail'; R SET APPS_NAME 'DebutDeploy'; \
  docker compose restart sogo-mailcow >/dev/null 2>&1"
echo "applied DebutDeploy branding to $HOST (sogo restarted)"
