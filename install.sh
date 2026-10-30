#!/usr/bin/env bash
# Run only after the complete function has been received by a piped shell.
tracking_install_main() {
  set -euo pipefail
  umask 077
  local source_file="${BASH_SOURCE[0]:-}" node_bin='' candidate portable=0
  local skill_root='' data_root runtime_root platform architecture checksums archive expected actual version
  if [ "${1:-}" = '--portable-node' ]; then portable=1; shift; fi
  command -v curl >/dev/null || { printf '%s\n' '未找到 curl，请让本机 AI 助手安装后重试。' >&2; return 1; }
  command -v tar >/dev/null || { printf '%s\n' '未找到 tar，请让本机 AI 助手安装后重试。' >&2; return 1; }
  data_root="${LI_AUTO_TRACKING_DATA:-$HOME/Documents/Codex/li-auto-event-tracking-data}"
  mkdir -p "$data_root"
  data_root="$(cd -- "$data_root" && pwd)"
  runtime_root="$data_root/runtime"
  if [ "$portable" = 0 ]; then
    for candidate in "$(command -v node || true)" "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
      if [ -n "$candidate" ] && [ -x "$candidate" ] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)' 2>/dev/null && { [ -x "$(dirname "$candidate")/npm" ] || command -v npm >/dev/null; }; then node_bin="$candidate"; break; fi
    done
  fi
  if [ -z "$node_bin" ] && [ -x "$runtime_root/node/bin/node" ] && "$runtime_root/node/bin/node" -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)' 2>/dev/null; then node_bin="$runtime_root/node/bin/node"; fi
  tracking_install_tmp="$(mktemp -d "${TMPDIR:-/tmp}/li-auto-install.XXXXXX")"
  tracking_runtime_lock=''
  trap 'if [ -n "${tracking_runtime_lock:-}" ]; then rmdir "$tracking_runtime_lock" 2>/dev/null || true; fi; rm -rf "$tracking_install_tmp"' EXIT
  if [ -z "$node_bin" ]; then
    case "$(uname -s)" in Darwin) platform=darwin;; Linux) platform=linux;; *) printf '%s\n' '自动安装运行环境支持 macOS/Linux；其他系统请先安装 Node.js 20+。' >&2; return 1;; esac
    case "$(uname -m)" in arm64|aarch64) architecture=arm64;; x86_64|amd64) architecture=x64;; *) printf '%s\n' '当前处理器架构需要先安装 Node.js 20+。' >&2; return 1;; esac
    mkdir -p "$runtime_root"
    if [ -e "$runtime_root/node" ]; then printf '%s\n' '技能专用运行环境不可用，请让本机 AI 助手检查后重试。' >&2; return 1; fi
    mkdir "$runtime_root/.install.lock" 2>/dev/null || { printf '%s\n' '运行环境正在安装，请等待完成后重试。' >&2; return 1; }
    tracking_runtime_lock="$runtime_root/.install.lock"
    printf '%s\n' '正在准备技能专用 Node.js，无需管理员权限……'
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 120 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$tracking_install_tmp/checksums.txt"
    checksums="$(awk -v suffix="-$platform-$architecture.tar.gz" '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-/ && substr($2,length($2)-length(suffix)+1)==suffix {print $1 " " $2}' "$tracking_install_tmp/checksums.txt")"
    expected="${checksums%% *}"; archive="${checksums#* }"
    if ! [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || ! [[ "$archive" =~ ^node-v24\.[0-9]+\.[0-9]+-(darwin|linux)-(arm64|x64)\.tar\.gz$ ]]; then printf '%s\n' 'Node.js 官方校验清单异常，已停止。' >&2; return 1; fi
    version="${archive#node-}"; version="${version%%-$platform-*}"
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 "https://nodejs.org/dist/$version/$archive" -o "$tracking_install_tmp/node.tar.gz"
    if command -v shasum >/dev/null; then actual="$(shasum -a 256 "$tracking_install_tmp/node.tar.gz")"; elif command -v sha256sum >/dev/null; then actual="$(sha256sum "$tracking_install_tmp/node.tar.gz")"; else printf '%s\n' '缺少 SHA-256 校验工具，已停止安装。' >&2; return 1; fi
    if [ "${actual%% *}" != "$expected" ]; then printf '%s\n' 'Node.js 下载校验失败，已停止。' >&2; return 1; fi
    mkdir "$tracking_install_tmp/node"
    tar -xzf "$tracking_install_tmp/node.tar.gz" -C "$tracking_install_tmp/node" --strip-components=1
    "$tracking_install_tmp/node/bin/node" -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)'
    mv "$tracking_install_tmp/node" "$runtime_root/node"
    rmdir "$tracking_runtime_lock"; tracking_runtime_lock=''
    node_bin="$runtime_root/node/bin/node"
  fi
  export PATH="$(dirname "$node_bin"):$PATH"
  if [ -n "$source_file" ] && [ -f "$source_file" ]; then
    candidate="$(cd -- "$(dirname -- "$source_file")" && pwd)"
    if [ -f "$candidate/release.json" ] && [ -f "$candidate/scripts/install.mjs" ]; then skill_root="$candidate"; fi
  fi
  if [ -z "$skill_root" ]; then
    printf '%s\n' '正在下载理想汽车埋点技能……'
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 120 https://codeload.github.com/javenvian-del/li-auto-event-tracking/tar.gz/refs/heads/main -o "$tracking_install_tmp/skill.tar.gz"
    skill_root="$tracking_install_tmp/skill"
    mkdir "$skill_root"
    tar -xzf "$tracking_install_tmp/skill.tar.gz" -C "$skill_root" --strip-components=1
  fi
  "$node_bin" "$skill_root/scripts/install.mjs" "$@"
}
tracking_install_main "$@"
