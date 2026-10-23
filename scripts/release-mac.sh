#!/usr/bin/env bash
# Build, sign, and notarize The Squeasel for macOS.
# Adapted from the Password Pitbull release script (same Bitclone Developer ID).
# Run this file. Do not source it.
# Credentials stay in the environment. This script never prints or stores them.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only runs on macOS." >&2
  exit 1
fi

missing=()
for name in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done
if ((${#missing[@]} > 0)); then
  echo "Missing required environment variables: ${missing[*]}" >&2
  echo "Export APPLE_ID, APPLE_PASSWORD (an app-specific password), and APPLE_TEAM_ID, then run this script again." >&2
  exit 1
fi

if [[ "$APPLE_TEAM_ID" != "N77C8S635X" ]]; then
  echo "APPLE_TEAM_ID is not the Bitclone team." >&2
  exit 1
fi

export APPLE_SIGNING_IDENTITY="Developer ID Application: Eric Baldoni (N77C8S635X)"

if ! command -v rustup >/dev/null 2>&1; then
  echo "rustup is not on PATH." >&2
  exit 1
fi
rustup target add aarch64-apple-darwin x86_64-apple-darwin

npm run tauri -- build --target universal-apple-darwin

TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}"
BUNDLE_DIR="$TARGET_DIR/universal-apple-darwin/release/bundle"

if [[ ! -d "$BUNDLE_DIR" ]]; then
  echo "The build finished without a universal bundle." >&2
  echo "Looked in $BUNDLE_DIR." >&2
  exit 1
fi

pick_one() {
  local dir="$1"
  local pattern="$2"
  local label="$3"
  local path
  local count=0
  PICKED=""
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    PICKED="$path"
    count=$((count + 1))
  done < <(find "$dir" -maxdepth 3 -name "$pattern" -print)
  if [[ "$count" -ne 1 ]]; then
    echo "Expected exactly one $label in $dir, found $count." >&2
    exit 1
  fi
}

pick_one "$BUNDLE_DIR" "*.app" ".app"
APP="$PICKED"
pick_one "$BUNDLE_DIR" "*.dmg" ".dmg"
DMG="$PICKED"

case "$(basename "$DMG")" in
  *universal*) ;;
  *)
    echo "The dmg name does not contain \"universal\": $DMG" >&2
    exit 1
    ;;
esac

BINARY="$APP/Contents/MacOS/squeasel"
if [[ ! -f "$BINARY" ]]; then
  echo "The universal executable is missing: $BINARY" >&2
  exit 1
fi

echo "== lipo -archs =="
archs="$(lipo -archs "$BINARY")"
printf '%s\n' "$archs"
for required in x86_64 arm64; do
  if ! grep -Eq "(^|[[:space:]])${required}([[:space:]]|$)" <<<"$archs"; then
    echo "The executable is missing $required." >&2
    exit 1
  fi
done

echo "== codesign --verify --deep --strict --verbose=2 =="
codesign --verify --deep --strict --verbose=2 "$APP"

echo "== codesign -dv --verbose=4 =="
details="$(codesign -dv --verbose=4 "$APP" 2>&1)"
printf '%s\n' "$details"
if ! grep -Eq 'flags=.*\(runtime\)' <<<"$details"; then
  echo "Hardened runtime is not set on the app." >&2
  exit 1
fi
if ! grep -Fq "TeamIdentifier=N77C8S635X" <<<"$details"; then
  echo "TeamIdentifier is not N77C8S635X." >&2
  exit 1
fi

echo "== spctl -a -vvv -t exec =="
set +e
spctl_out="$(spctl -a -vvv -t exec "$APP" 2>&1)"
spctl_status=$?
set -e
printf '%s\n' "$spctl_out"
if [[ "$spctl_status" -ne 0 ]]; then
  exit "$spctl_status"
fi
if ! grep -Fq "accepted" <<<"$spctl_out"; then
  echo "Gatekeeper did not accept the app." >&2
  exit 1
fi
if ! grep -Fq "source=Notarized Developer ID" <<<"$spctl_out"; then
  echo "Gatekeeper source is not Notarized Developer ID." >&2
  exit 1
fi

echo "== xcrun stapler validate (.app) =="
xcrun stapler validate "$APP"

echo "== xcrun stapler validate (.dmg) =="
xcrun stapler validate "$DMG"

echo "App: $APP"
echo "Dmg: $DMG"
