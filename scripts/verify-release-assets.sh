#!/usr/bin/env bash
# Compare a release's actual asset names (stdin, one per line) with the exact
# expected set (arguments). Publishing a draft flips every attached asset public
# at once, so any missing or unexpected asset fails closed — a stray upload that
# was never validated (and is absent from SHA256SUMS) can never ship.
#
# Usage: gh release view "$TAG" --json assets --jq '.assets[].name' \
#          | scripts/verify-release-assets.sh <expected-asset>...
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/verify-release-assets.sh <expected-asset>... < actual-asset-names" >&2
  exit 2
fi

actual=()
while IFS= read -r name || [ -n "$name" ]; do
  [ -n "$name" ] && actual+=("$name")
done

contains() {  # <needle> <haystack>...
  local needle="$1" item
  shift
  for item in "$@"; do [ "$item" = "$needle" ] && return 0; done
  return 1
}

fail=0
for name in ${actual[@]+"${actual[@]}"}; do
  if ! contains "$name" "$@"; then
    echo "::error::unexpected release asset '$name' (never validated, absent from SHA256SUMS); refusing to publish" >&2
    fail=1
  fi
done
for expected in "$@"; do
  if ! contains "$expected" ${actual[@]+"${actual[@]}"}; then
    echo "::error::expected release asset missing: '$expected'" >&2
    fail=1
  fi
done

[ "$fail" -eq 0 ] || exit 1
echo "verified release asset set: $*"
