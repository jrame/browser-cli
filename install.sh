#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1; then
    echo 'Node.js 20 or newer is required. Install Linux Node.js inside WSL, then run this installer again.' >&2
    exit 1
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$script_dir/scripts/install-release.cjs" "$@"
