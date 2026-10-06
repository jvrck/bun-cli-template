# End-to-End Testing (opt-in tier)

This tier is **parked** — it is inert until you enable it (see
[`optional/README.md`](../README.md)). It adds a per-PR binary lifecycle smoke on
top of the lean-core `ci` workflow.

## GitHub Actions Coverage

`e2e.yml` runs on pull requests to `main`/`epic/**` and through manual
`workflow_dispatch`. Its one Ubuntu job, `binary-smoke`, builds `dist/mytool`
from the current checkout and runs `scripts/smoke-release-asset.sh` against the
compiled binary with fresh state under `$RUNNER_TEMP`. It uploads diagnostics
only on failure.

The smoke is the same script the release and validate workflows use: it asserts
identity (`--version`), help (`--help`), and that the example subcommand runs.
Extend it as your engine grows.

## Local Binary Smoke

```bash
bun run build
MYTOOL_BIN="$PWD/dist/mytool" \
  EXPECTED_VERSION=0.0.0-dev \
  MYTOOL_SMOKE_ROOT="$(mktemp -d)" \
  scripts/smoke-release-asset.sh
```

Set `MYTOOL_SMOKE_DIAG_DIR` to copy failure diagnostics into a known directory
for the workflow to upload as an artifact.

## When to enable

Enable the e2e tier when your CLI grows real side effects (filesystem, network,
subprocesses) whose lifecycle is worth exercising against the compiled binary on
every PR — not just the unit/typecheck/build coverage the lean-core `ci`
workflow already provides.
