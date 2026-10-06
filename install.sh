#!/usr/bin/env bash
# Install mytool from a GitHub Release.
#
# Detects the platform, downloads the matching mytool-<os>-<arch> asset and the
# release's SHA256SUMS, verifies the checksum, checks that the binary runs and
# reports the release version, then installs it as `mytool` with an atomic swap.
# Re-running upgrades in place. No Bun required on the target host — the binary
# is self-contained.
#
# Download channels (MYTOOL_INSTALL_AUTH):
#   auto       anonymous HTTPS first, then an authenticated `gh`, then
#              GH_TOKEN/GITHUB_TOKEN. Public repos need no credentials. (default)
#   anonymous  anonymous HTTPS only (public repos).
#   gh         an authenticated GitHub CLI only (private repos).
#   token      GH_TOKEN/GITHUB_TOKEN via the REST API only (private repos, CI).
#
# Env overrides:
#   MYTOOL_REPO           repo to install from    (default: jvrck/bun-cli-template)
#   MYTOOL_VERSION        CalVer tag or "latest"  (default: latest)
#   MYTOOL_INSTALL_AUTH   download channel        (default: auto)
#   BIN_DIR               install directory       (default: $HOME/.local/bin)
#   MYTOOL_DOWNLOAD_BASE  GitHub web base URL     (default: https://github.com)
#   MYTOOL_API_BASE       GitHub REST base URL    (default: https://api.github.com)
#
# Requires bash, curl (>= 7.58 for the token channel), and sha256sum or shasum.
# SHA256SUMS comes from the same release, so it detects corrupt or truncated
# downloads; it is not a signature and cannot detect a compromised release.
set -euo pipefail

MYTOOL_REPO="${MYTOOL_REPO:-jvrck/bun-cli-template}"
MYTOOL_VERSION="${MYTOOL_VERSION:-latest}"
MYTOOL_INSTALL_AUTH="${MYTOOL_INSTALL_AUTH:-auto}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
MYTOOL_DOWNLOAD_BASE="${MYTOOL_DOWNLOAD_BASE:-https://github.com}"
MYTOOL_API_BASE="${MYTOOL_API_BASE:-https://api.github.com}"

# Fail fast on unreachable hosts and abort stalled transfers (<1 KiB/s for 60s).
CURL_OPTS=(--connect-timeout 20 --retry 2 --speed-limit 1024 --speed-time 60)
# With the default https endpoints, never follow a redirect to plain http.
case "$MYTOOL_DOWNLOAD_BASE $MYTOOL_API_BASE" in
  https://*\ https://*) CURL_OPTS+=(--proto '=https' --proto-redir '=https') ;;
esac

note() { printf '%s\n' "$*" >&2; }
die()  { printf 'mytool install: %s\n' "$*" >&2; exit 1; }

parse_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      -h|--help)
        note "usage: install.sh   (configure with MYTOOL_REPO, MYTOOL_VERSION, MYTOOL_INSTALL_AUTH, BIN_DIR)"
        note "see the header of install.sh or docs/running.md for details"
        exit 0 ;;
      *) die "unknown option: $arg" ;;
    esac
  done
}

detect_asset() {
  local os arch
  case "$(uname -s)" in
    Linux)  os=linux ;;
    Darwin) os=darwin ;;
    *) die "unsupported OS: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64)  arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac
  if [ "$os" = linux ] && [ "$arch" = x64 ]; then
    # musl's ldd prints its banner and exits 1, so capture it rather than
    # piping (a failing pipeline under pipefail would hide the match).
    local libc=""
    if command -v ldd >/dev/null 2>&1; then libc="$(ldd --version 2>&1 || true)"; fi
    case "$libc" in *[Mm]usl*) arch=x64-musl ;; esac
    if [ -f /etc/alpine-release ]; then arch=x64-musl; fi
  fi
  case "$os-$arch" in
    linux-x64|linux-arm64|linux-x64-musl|darwin-arm64) printf 'mytool-%s-%s\n' "$os" "$arch" ;;
    *) die "no published binary for $os-$arch" ;;
  esac
}

# Each fetch_<channel> downloads <asset> and SHA256SUMS for MYTOOL_VERSION into
# <dest> and sets RESOLVED_TAG, or returns nonzero with a one-line `reason`.
RESOLVED_TAG=""
reason=""

# GET <url> into <out>, following redirects. Prints "<final HTTP status> <curl
# exit code>" instead of failing, so callers can tell an HTTP error from an
# interrupted transfer.
http_get() {  # <url> <out> [curl args...]
  local url="$1" out="$2" status rc=0
  shift 2
  status="$(curl -sSL "${CURL_OPTS[@]}" -o "$out" -w '%{http_code}' "$@" "$url" 2>/dev/null)" || rc=$?
  printf '%s %s\n' "${status:-000}" "$rc"
}

# The reason for a failed http_get, or nothing when it succeeded (HTTP 200).
fetch_problem() {  # <status> <curl-exit> <what>
  if [ "$2" != 0 ] && [ "$1" = 200 ]; then
    printf 'download of %s was interrupted (curl exit %s)' "$3" "$2"
  elif [ "$1" != 200 ]; then
    printf 'HTTP %s for %s' "$1" "$3"
  fi
}

# The token channel needs curl >= 7.58: `-H @-` (7.55) keeps the token out of
# argv, and 7.58 stops sending custom Authorization headers to redirect hosts.
curl_supports_token_channel() {
  local version major minor
  version="$(curl --version 2>/dev/null | head -1 | awk '{print $2}')"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  case "$major$minor" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -gt 7 ] || { [ "$major" -eq 7 ] && [ "$minor" -ge 58 ]; }
}

# Authenticated REST GET. The Authorization header is read from stdin so the
# token never appears in the process list; curl drops it on cross-host redirects.
api_get() {  # <token> <url> <out> <accept>
  printf 'Authorization: Bearer %s\n' "$1" \
    | http_get "$2" "$3" -H @- -H "Accept: $4" -H 'X-GitHub-Api-Version: 2022-11-28'
}

# The REST asset id for <name> in a release JSON document. A small
# string-aware JSON scanner (POSIX awk) looks only at each object's OWN members:
# the asset is the one object whose "name" equals <name> and whose "url" ends
# in /releases/assets/<id> (its own "id", if present, must agree), in any key
# order and any whitespace. Nested objects, other assets and text inside
# strings (e.g. release notes) cannot supply the id.
# Exit 0 and print the id for exactly one match; 1 for no match; 2 for an
# ambiguous match (several assets, duplicate keys, id/url disagreement) or
# malformed JSON.
asset_id() {  # <release-json> <name>
  printf '%s\n' "$1" | ASSET_NAME="$2" awk '
    function value_token() {
      if (tok != "") {
        if (kind[depth] == "{" && last == ":" && key[depth] == "id") idv[depth] = tok
        last = "v"; tok = ""
      }
    }
    function string_token(s) {
      if (kind[depth] == "{" && (last == "{" || last == ",")) { key[depth] = s }
      else if (kind[depth] == "{" && last == ":") {
        if (key[depth] == "name") { if (hasname[depth]) dup[depth] = 1; nm[depth] = s; hasname[depth] = 1 }
        if (key[depth] == "url") { if (hasurl[depth]) dup[depth] = 1; url[depth] = s; hasurl[depth] = 1 }
        if (key[depth] == "id") idv[depth] = s
      }
      last = "v"
    }
    function close_object(   n) {
      if (!hasname[depth] || nm[depth] != want) return
      if (dup[depth]) { ambiguous = 1; return }
      if (url[depth] !~ /\/releases\/assets\/[0-9]+$/) return
      n = url[depth]; sub(/.*\/releases\/assets\//, "", n)
      if (idv[depth] != "" && idv[depth] != n) { ambiguous = 1; return }
      matches++; found = n
    }
    BEGIN { want = ENVIRON["ASSET_NAME"]; depth = 0; instr = 0; esc = 0; last = ""; tok = "" }
    {
      len = length($0)
      for (i = 1; i <= len; i++) {
        c = substr($0, i, 1)
        if (instr) {
          if (esc) { buf = buf ((c == "/" || c == "\"" || c == "\\") ? c : "\\" c); esc = 0 }
          else if (c == "\\") esc = 1
          else if (c == "\"") { instr = 0; string_token(buf) }
          else buf = buf c
          continue
        }
        if (c == "\"") { value_token(); instr = 1; buf = ""; continue }
        if (c == "{" || c == "[") {
          value_token(); depth++; kind[depth] = c
          key[depth] = ""; nm[depth] = ""; url[depth] = ""; idv[depth] = ""
          hasname[depth] = 0; hasurl[depth] = 0; dup[depth] = 0
          last = c; continue
        }
        if (c == "}" || c == "]") {
          value_token()
          if (depth == 0 || (c == "}" && kind[depth] != "{") || (c == "]" && kind[depth] != "[")) { malformed = 1; exit }
          if (c == "}") close_object()
          depth--; last = "v"; continue
        }
        if (c == ":" || c == ",") { value_token(); last = c; continue }
        if (c == " " || c == "\t" || c == "\r") { value_token(); continue }
        tok = tok c
      }
    }
    END {
      if (malformed || instr || depth != 0) exit 2
      if (ambiguous || matches > 1) exit 2
      if (matches == 0) exit 1
      print found
    }'
}

fetch_anonymous() {  # <asset> <dest>
  local asset="$1" dest="$2" base="$MYTOOL_DOWNLOAD_BASE/$MYTOOL_REPO/releases" tag="$MYTOOL_VERSION" name status rc effective
  command -v curl >/dev/null 2>&1 || { reason="curl is not installed"; return 1; }
  if [ "$tag" = latest ]; then
    # Resolve "latest" to a concrete tag once (via the web redirect, which is not
    # API rate-limited) so the asset and SHA256SUMS come from the same release.
    effective="$(curl -sS "${CURL_OPTS[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "$base/latest" 2>/dev/null || true)"
    case "$effective" in
      30[12378]\ */releases/tag/*) tag="${effective##*/releases/tag/}" ;;
      404\ *) reason="HTTP 404 for $base/latest (private repo, or no such repo)"; return 1 ;;
      *) reason="could not resolve the latest release from $base/latest (HTTP ${effective%% *}; no published release?)"; return 1 ;;
    esac
  fi
  for name in "$asset" SHA256SUMS; do
    read -r status rc <<< "$(http_get "$base/download/$tag/$name" "$dest/$name")"
    if [ "$status" = 404 ]; then
      rm -f "$dest/$name"
      reason="$name not found in release $tag (HTTP 404: private repo, or missing release/asset)"
      return 1
    fi
    reason="$(fetch_problem "$status" "$rc" "$base/download/$tag/$name")"
    if [ -n "$reason" ]; then rm -f "$dest/$name"; return 1; fi
  done
  RESOLVED_TAG="$tag"
}

fetch_gh() {  # <asset> <dest>
  local asset="$1" dest="$2" tag="$MYTOOL_VERSION" name
  command -v gh >/dev/null 2>&1 || { reason="gh is not installed"; return 1; }
  gh auth status >/dev/null 2>&1 || { reason="gh is not authenticated (run: gh auth login)"; return 1; }
  if [ "$tag" = latest ]; then
    tag="$(gh release view -R "$MYTOOL_REPO" --json tagName -q .tagName 2>/dev/null)" && [ -n "$tag" ] \
      || { reason="gh found no published release in $MYTOOL_REPO"; return 1; }
  fi
  for name in "$asset" SHA256SUMS; do
    if ! gh release download "$tag" -R "$MYTOOL_REPO" -p "$name" -D "$dest" --clobber >/dev/null 2>&1 || ! [ -s "$dest/$name" ]; then
      reason="$name not found in release $tag (gh release download failed)"
      return 1
    fi
  done
  RESOLVED_TAG="$tag"
}

fetch_token() {  # <asset> <dest>
  local asset="$1" dest="$2" token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  local api="$MYTOOL_API_BASE/repos/$MYTOOL_REPO/releases" url status rc json tag name id lookup
  [ -n "$token" ] || { reason="GH_TOKEN/GITHUB_TOKEN is not set"; return 1; }
  command -v curl >/dev/null 2>&1 || { reason="curl is not installed"; return 1; }
  curl_supports_token_channel || { reason="the token channel needs curl >= 7.58 (found: $(curl --version 2>/dev/null | head -1 | awk '{print $2}'))"; return 1; }
  if [ "$MYTOOL_VERSION" = latest ]; then url="$api/latest"; else url="$api/tags/$MYTOOL_VERSION"; fi
  read -r status rc <<< "$(api_get "$token" "$url" "$dest/release.json" application/vnd.github+json)"
  if [ "$status" != 200 ] || [ "$rc" != 0 ]; then
    rm -f "$dest/release.json"
    reason="$(fetch_problem "$status" "$rc" "$url") (does the token have read access to $MYTOOL_REPO, and does the release exist?)"
    return 1
  fi
  json="$(cat "$dest/release.json")"
  rm -f "$dest/release.json"
  tag="$(printf '%s' "$json" | tr -d '\r\n' | grep -oE '"tag_name": *"[^"]+"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/' || true)"
  [ -n "$tag" ] || { reason="unexpected release response from $url (no tag_name)"; return 1; }
  for name in "$asset" SHA256SUMS; do
    lookup=0
    id="$(asset_id "$json" "$name")" || lookup=$?
    case "$lookup" in
      0) ;;
      1) reason="$name not found in release $tag"; return 1 ;;
      *) reason="ambiguous or malformed release data for $name in release $tag; refusing to guess"; return 1 ;;
    esac
    read -r status rc <<< "$(api_get "$token" "$api/assets/$id" "$dest/$name" application/octet-stream)"
    reason="$(fetch_problem "$status" "$rc" "$name from release $tag")"
    if [ -n "$reason" ]; then rm -f "$dest/$name"; return 1; fi
  done
  RESOLVED_TAG="$tag"
}

download() {  # <asset> <dest>
  local asset="$1" dest="$2" channels channel failures=""
  case "$MYTOOL_INSTALL_AUTH" in
    auto) channels="anonymous gh token" ;;
    anonymous|gh|token) channels="$MYTOOL_INSTALL_AUTH" ;;
    *) die "MYTOOL_INSTALL_AUTH must be auto, anonymous, gh, or token (got: $MYTOOL_INSTALL_AUTH)" ;;
  esac
  for channel in $channels; do
    reason=""
    if "fetch_$channel" "$asset" "$dest"; then
      note "mytool install: downloaded $asset ($RESOLVED_TAG) via $channel"
      return 0
    fi
    rm -f "$dest/$asset" "$dest/SHA256SUMS"
    failures="$failures
  $channel: $reason"
  done
  die "could not download $asset from $MYTOOL_REPO (version $MYTOOL_VERSION):$failures
For a private repo, authenticate with 'gh auth login' or export GH_TOKEN, then re-run."
}

verify_checksum() {  # <dir> <asset>
  local dir="$1" asset="$2" ok=0
  grep -E "^[0-9a-fA-F]{64}[[:space:]]+\*?${asset}\$" "$dir/SHA256SUMS" > "$dir/SHA256SUMS.one" \
    || die "SHA256SUMS in release $RESOLVED_TAG has no entry for $asset"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$dir" && sha256sum -c SHA256SUMS.one >/dev/null 2>&1) && ok=1
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$dir" && shasum -a 256 -c SHA256SUMS.one >/dev/null 2>&1) && ok=1
  else
    die "need sha256sum or shasum to verify the download"
  fi
  [ "$ok" = 1 ] || die "checksum mismatch for $asset in release $RESOLVED_TAG; refusing to install (corrupt or truncated download, or the release's SHA256SUMS does not match its assets)"
}

# Stage next to the target, prove the binary runs and is the release we asked
# for, then swap atomically. Any failure leaves an existing install untouched.
install_binary() {  # <dir> <asset>
  local version
  mkdir -p "$BIN_DIR"
  staged="$(mktemp "$BIN_DIR/.mytool.XXXXXX")"
  cp "$1/$2" "$staged"
  chmod 0755 "$staged"
  if ! version="$("$staged" --version 2>/dev/null)"; then
    rm -f "$staged"
    die "the downloaded $2 did not run (--version failed); existing install left untouched"
  fi
  if [ "$version" != "${RESOLVED_TAG#v}" ]; then
    rm -f "$staged"
    die "the downloaded $2 reports version '$version', expected '${RESOLVED_TAG#v}'; existing install left untouched"
  fi
  mv -f "$staged" "$BIN_DIR/mytool"
  staged=""
  note "installed: $BIN_DIR/mytool ($version)"
}

# Cleanup runs from the EXIT trap, after main() returns, so the temp dir and the
# staged binary must be globals (a `local` would be out of scope under `set -u`).
tmp=""
staged=""
cleanup() {
  if [ -n "${tmp:-}" ]; then rm -rf "$tmp"; fi
  if [ -n "${staged:-}" ]; then rm -f "$staged"; fi
  return 0
}
trap cleanup EXIT

main() {
  local asset
  asset="$(detect_asset)"
  note "mytool install: asset=$asset repo=$MYTOOL_REPO version=$MYTOOL_VERSION auth=$MYTOOL_INSTALL_AUTH"

  tmp="$(mktemp -d)"
  download "$asset" "$tmp"
  verify_checksum "$tmp" "$asset"
  install_binary "$tmp" "$asset"

  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) note "NOTE: $BIN_DIR is not on your PATH. Add it (e.g. to ~/.zshenv or ~/.bash_profile):"
       note "  export PATH=\"$BIN_DIR:\$PATH\"" ;;
  esac
}

parse_args "$@"
main "$@"
