#!/usr/bin/env bash
# Validate one downloaded mytool release binary in an isolated lifecycle.
#
# Generic version+help+example-subcommand smoke. The binary is self-contained
# with no session or host surface, so this is the full bar:
#   - `mytool --version` matches the release tag,
#   - `mytool --help` prints usage and exits zero,
#   - the example subcommand (`mytool hello`) runs and greets.
# Replace the example-subcommand assertion with your tool's real smoke as the
# engine grows (see docs/release-validation.md).
#
# Required:
#   MYTOOL_BIN        path to the executable release asset
#   EXPECTED_VERSION  release version that `mytool --version` must print
#
# Optional:
#   MYTOOL_SMOKE_ROOT      directory for temporary cwd/output files
#   MYTOOL_SMOKE_DIAG_DIR  directory where failure diagnostics are copied
set -euo pipefail

note() { printf '%s\n' "$*" >&2; }
die() { printf 'mytool smoke: %s\n' "$*" >&2; exit 1; }

MYTOOL_BIN="${MYTOOL_BIN:-}"
EXPECTED_VERSION="${EXPECTED_VERSION:-}"
MYTOOL_SMOKE_DIAG_DIR="${MYTOOL_SMOKE_DIAG_DIR:-}"

[ -n "$MYTOOL_BIN" ] || die "MYTOOL_BIN is required"
[ -n "$EXPECTED_VERSION" ] || die "EXPECTED_VERSION is required"
[ -f "$MYTOOL_BIN" ] || die "binary not found: $MYTOOL_BIN"
[ -x "$MYTOOL_BIN" ] || die "binary is not executable: $MYTOOL_BIN"

own_root=0
if [ -n "${MYTOOL_SMOKE_ROOT:-}" ]; then
  root="$MYTOOL_SMOKE_ROOT"
  mkdir -p "$root"
else
  root="$(mktemp -d)"
  own_root=1
fi

cwd="$root/cwd"
output_dir="$root/output"
install_dir="$root/bin"
installed_bin="$install_dir/mytool"
mkdir -p "$cwd" "$output_dir" "$install_dir"
cp "$MYTOOL_BIN" "$installed_bin"
chmod 0755 "$installed_bin"

collect_diagnostics() {
  local status="$1"
  local diag_dir="$MYTOOL_SMOKE_DIAG_DIR"
  if [ -z "$diag_dir" ]; then
    diag_dir="$root/diagnostics"
  fi
  mkdir -p "$diag_dir"

  {
    printf 'status=%s\n' "$status"
    printf 'root=%s\n' "$root"
    printf 'installed_bin=%s\n' "$installed_bin"
    date -u
    uname -a
    "$installed_bin" --version || true
  } > "$diag_dir/environment.txt" 2>&1 || true

  cp -R "$output_dir" "$diag_dir/output" 2>/dev/null || true
}

cleanup() {
  local status="$?"
  if [ "$status" -ne 0 ]; then
    collect_diagnostics "$status"
  fi

  if [ "$own_root" -eq 1 ] && [ "$status" -eq 0 ]; then
    rm -rf "$root"
  fi
  exit "$status"
}
trap cleanup EXIT

expected_version="${EXPECTED_VERSION#v}"
actual_version="$("$installed_bin" --version)"
[ "$actual_version" = "$expected_version" ] || die "expected version $expected_version, got $actual_version"

"$installed_bin" --help > "$output_dir/help.txt" 2> "$output_dir/help.err" || die "--help failed"
[ -s "$output_dir/help.txt" ] || die "--help produced no output"

note "mytool smoke: running the example subcommand"
"$installed_bin" hello > "$output_dir/hello.txt" 2> "$output_dir/hello.err" || die "hello failed"
grep -q 'Hello' "$output_dir/hello.txt" || die "hello did not greet"

note "mytool smoke: ok"
