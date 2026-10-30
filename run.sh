#!/usr/bin/env bash
set -euo pipefail
skill_root="$(cd -- "$(dirname -- "$0")" && pwd)"
for candidate in "$(command -v node || true)" "${LI_AUTO_TRACKING_DATA:-$HOME/Documents/Codex/li-auto-event-tracking-data}/runtime/node/bin/node" "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -n "$candidate" ] && [ -x "$candidate" ] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)' 2>/dev/null; then
    exec "$candidate" "$skill_root/scripts/control.mjs" "$@"
  fi
done
printf '%s\n' '需要本机 Node.js 20+。请由当前 AI 助手完成环境配置；云端对话请先切换为本机执行。' >&2
exit 1
