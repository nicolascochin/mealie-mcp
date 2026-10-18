#!/usr/bin/env bash
# SessionStart hook: in Claude Code cloud sessions, install the Node.js version pinned in
# .node-version and the npm dependencies. Does nothing elsewhere.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

version="$(tr -d '[:space:]' < .node-version)"
version="${version#v}"

case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) echo "session-start: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

dist="node-v${version}-linux-${arch}"
node_dir="/opt/${dist}"

if [ ! -x "${node_dir}/bin/node" ]; then
  echo "session-start: installing Node.js ${version} in ${node_dir}" >&2
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  base="https://nodejs.org/dist/v${version}"
  curl -fsSL --retry 3 -o "${tmp}/${dist}.tar.xz" "${base}/${dist}.tar.xz"
  curl -fsSL --retry 3 -o "${tmp}/SHASUMS256.txt" "${base}/SHASUMS256.txt"
  (cd "$tmp" && grep " ${dist}.tar.xz\$" SHASUMS256.txt | sha256sum -c - >&2)
  tar -xJf "${tmp}/${dist}.tar.xz" -C "$tmp"
  mv "${tmp}/${dist}" "$node_dir"
fi

export PATH="${node_dir}/bin:${PATH}"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"${node_dir}/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

# Skip the install when node_modules was built from the same manifest, lockfile and Node version.
stamp=node_modules/.session-start-stamp
deps_checksum() {
  local files=(package.json)
  [ -f package-lock.json ] && files+=(package-lock.json)
  echo "$(cat "${files[@]}" | sha256sum | cut -d' ' -f1)-${version}"
}
checksum="$(deps_checksum)"
if [ -d node_modules ] && [ "$(cat "$stamp" 2>/dev/null)" = "$checksum" ]; then
  echo "session-start: dependencies up to date" >&2
  exit 0
fi

if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund >&2
else
  npm install --no-audit --no-fund >&2
  # npm install created the lockfile: record its checksum, not the empty one.
  checksum="$(deps_checksum)"
fi
echo "$checksum" > "$stamp"
