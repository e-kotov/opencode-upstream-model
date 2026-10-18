#!/usr/bin/env bash
# Install the OpenCode 2 upstream-model plugin into an OpenCode config directory.
#
# OpenCode 2 discovers plugin *directories* under `<config>/plugins/`: the
# directory's `server.js` is the server half and `tui.tsx` the TUI half, and
# both load without any registration. Helper modules therefore live inside the
# plugin directory; an immediate `.js` file in `plugins/` would itself be
# loaded as a (broken) plugin.
#
# Options are only written when given. `--providers` goes to the server entry
# in opencode.json (it decides which provider responses are observed).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
NAME="upstream-model"
PROVIDERS=""
REMOVE_LEGACY=0
FILES=(server.js tui.tsx logic.mjs rpc.mjs status-store.mjs remote-status.mjs)
LEGACY=(plugins/upstream-model-server.js plugins/upstream-model-tui.tsx)

usage() {
  cat <<'USAGE'
usage: install.sh [--dest DIR] [--providers ID[,ID...]] [--remove-legacy]

  --dest DIR        OpenCode config directory (default: $OPENCODE_CONFIG_DIR,
                    else $XDG_CONFIG_HOME/opencode, else ~/.config/opencode)
  --providers IDS   Providers whose responses are observed (default: saia,kiconnect).
                    Written to opencode.json as the server plugin's options.
  --remove-legacy   Delete this plugin's OpenCode 1 files from plugins/, which
                    OpenCode 2 would otherwise try, and fail, to load.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="${2:?--dest needs a directory}"; shift 2 ;;
    --dest=*) DEST="${1#--dest=}"; shift ;;
    --providers) PROVIDERS="${2:?--providers needs a list}"; shift 2 ;;
    --providers=*) PROVIDERS="${1#--providers=}"; shift ;;
    --remove-legacy) REMOVE_LEGACY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'install.sh: unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -n "$PROVIDERS" ] && ! [[ "$PROVIDERS" =~ ^[A-Za-z0-9._-]+(,[A-Za-z0-9._-]+)*$ ]]; then
  printf 'install.sh: --providers must be a comma-separated list of provider IDs\n' >&2
  exit 2
fi

TARGET="$DEST/plugins/$NAME"
STAGE="$TARGET.$$.tmp"
mkdir -p "$DEST/plugins"
rm -rf "$STAGE"
mkdir -p "$STAGE"
trap 'rm -rf "$STAGE"' EXIT
for file in "${FILES[@]}"; do cp "$SCRIPT_DIR/src/$file" "$STAGE/$file"; done
# Installed outside this repository, the files would not inherit its
# `"type": "module"`.
printf '{\n  "name": "opencode-%s",\n  "private": true,\n  "type": "module"\n}\n' "$NAME" > "$STAGE/package.json"
rm -rf "$TARGET"
mv "$STAGE" "$TARGET"
trap - EXIT

python3 - "$DEST" "$NAME" "$PROVIDERS" <<'PY'
import json, pathlib, sys

dest, name, providers = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
if not providers:
    raise SystemExit(0)
path = dest / "opencode.json"
config = json.loads(path.read_text()) if path.exists() else {"$schema": "https://opencode.ai/config.json"}
if not isinstance(config, dict):
    raise SystemExit(f"install.sh: {path} is not a JSON object")
plugins = config.get("plugins", [])
if not isinstance(plugins, list):
    raise SystemExit(f'install.sh: {path} has a non-list "plugins"')
package = f"./plugins/{name}"

def target(item):
    return item.get("package") if isinstance(item, dict) else item

def same(item):
    value = target(item)
    return isinstance(value, str) and value.rstrip("/").split("/")[-1] == name

index = next((i for i, item in enumerate(plugins) if same(item)), None)
current = plugins[index].get("options", {}) if index is not None and isinstance(plugins[index], dict) else {}
options = dict(current) if isinstance(current, dict) else {}
options["providers"] = [item for item in providers.split(",") if item]
entry = {"package": package, "options": options}
if index is None:
    plugins.append(entry)
else:
    plugins[index] = entry
config["plugins"] = plugins
path.write_text(json.dumps(config, indent=2) + "\n")
PY

for legacy in "${LEGACY[@]}"; do
  if [ -e "$DEST/$legacy" ]; then
    if [ "$REMOVE_LEGACY" = 1 ]; then
      rm -f "$DEST/$legacy"
      printf 'removed OpenCode 1 file %s\n' "$DEST/$legacy"
    else
      printf 'warning: OpenCode 1 file %s is still present; OpenCode 2 cannot load it (re-run with --remove-legacy)\n' "$DEST/$legacy" >&2
    fi
  fi
done

printf '✓ %s\n' "$TARGET"
[ -n "$PROVIDERS" ] && printf '✓ %s → providers %s\n' "$DEST/opencode.json" "$PROVIDERS"
printf 'Restart OpenCode (or let it hot-reload) to pick up the change.\n'
