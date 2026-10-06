#!/usr/bin/env bash
# Decide whether release <tag> should be marked "Latest" (what install.sh's
# `latest` resolves to). Prints `true` or `false` on stdout.
#
#   - no published release yet (HTTP 404 from releases/latest)   -> true
#   - <tag> is the current Latest or has a higher CalVer         -> true
#   - an already-published release with a higher CalVer is Latest -> false
#   - anything else (5xx, auth/rate-limit errors, no response,
#     a non-CalVer Latest, an unreadable response)                -> exit 1
#
# Only a proven absence counts as "no Latest yet"; an unknown result fails so
# the caller leaves the draft unpublished rather than risk moving Latest to an
# older release. Requires GH_REPO and an authenticated gh.
#
# Usage: scripts/release-latest.sh <tag>
set -euo pipefail

calver='^[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$'
tag="${1:-}"
repo="${GH_REPO:-}"
[ -n "$repo" ] || { echo "::error::release-latest: GH_REPO is required" >&2; exit 1; }
[[ "$tag" =~ $calver ]] || { echo "::error::release-latest: not a CalVer tag: '$tag'" >&2; exit 1; }

err="$(mktemp)"
trap 'rm -f "$err"' EXIT
response="$(gh api -i "repos/$repo/releases/latest" 2>"$err")" || true
status="$(printf '%s\n' "$response" | head -1 | awk '{print $2}')"

case "$status" in
  404)
    current="" ;;
  200)
    current="$(printf '%s' "$response" | tr -d '\r\n' | grep -oE '"tag_name": *"[^"]*"' | head -1 | sed -E 's/.*"([^"]*)"$/\1/' || true)"
    if ! [[ "$current" =~ $calver ]]; then
      echo "::error::release-latest: current Latest release has no CalVer tag ('$current'); refusing to decide" >&2
      exit 1
    fi ;;
  *)
    echo "::error::release-latest: could not determine the current Latest release (HTTP ${status:-none}): $(head -c 300 "$err")" >&2
    exit 1 ;;
esac

if [ -z "$current" ] || [ "$current" = "$tag" ]; then
  echo "release-latest: current Latest: ${current:-none}; $tag becomes Latest" >&2
  echo true
  exit 0
fi

highest="$(printf '%s\n%s\n' "$current" "$tag" | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1)"
if [ "$highest" = "$tag" ]; then
  echo "release-latest: current Latest: $current; $tag is newer and becomes Latest" >&2
  echo true
else
  echo "release-latest: current Latest: $current is newer; $tag is published without becoming Latest" >&2
  echo false
fi
