# Release Asset Validation

Release validation proves that each `mytool` executable asset can be installed
and used on a compatible target. There are two modes:

- **Pre-publish** validation in `.github/workflows/release.yml` downloads each
  binary from the run's **draft** release and blocks publication until all
  required smoke jobs pass.
- **Post-publish** validation in `.github/workflows/validate-release.yml` is
  manually triggered with a tag, downloads the already-published assets plus
  `SHA256SUMS`, and rechecks what users can download.

The default path uses GitHub-hosted runners — Linux x64, Linux arm64
(`ubuntu-24.04-arm`), and arm64 macOS (`macos-15`) — so every asset is exercised
on its native platform without self-hosted infrastructure. See
GitHub's runner reference:
<https://docs.github.com/en/actions/reference/runners/github-hosted-runners>.

## Coverage strategy

Four binary assets per release; no `darwin-x64`. Every asset runs on a runtime
that matches its platform:

| Asset | Environment | Notes |
| --- | --- | --- |
| `mytool-linux-x64` | `ubuntu-latest` | Native glibc Linux smoke. |
| `mytool-linux-x64-musl` | Alpine container on `ubuntu-latest` | Runs inside Alpine with `bash`, `coreutils`, `libstdc++` so musl compatibility is tested directly. |
| `mytool-linux-arm64` | `ubuntu-24.04-arm` | Native arm64 Linux smoke. |
| `mytool-darwin-arm64` | `macos-15` | Native Apple Silicon macOS smoke. |

## Pre-publish workflow

`release.yml` runs automatically for `20[0-9][0-9].*` tag pushes:

```text
create-release (draft) -> build -> validate-native + validate-linux-musl -> release
```

The build jobs upload each binary to a draft release; the validation jobs
download it from the draft (draft assets need a token with `contents: write`).
Each checks that the binary exists, makes it executable, verifies
`mytool --version` against the tag, runs `mytool --help`, and runs the shared
smoke. The publish job generates and scans `sbom.cdx.json`, creates
`SHA256SUMS`, verifies the draft's exact asset set, and publishes only after
validation and the SBOM scan pass. See [releasing.md](./releasing.md#safeguards-and-recovery)
for the guards against modifying a published release.

## Post-publish workflow

```bash
gh workflow run validate-release.yml -f tag=2026.06.12
```

It downloads the requested asset + `SHA256SUMS` with the workflow token, verifies
the checksum, runs `--version`/`--help`, and runs the shared smoke.

## Smoke script

`scripts/smoke-release-asset.sh` validates one downloaded binary and is reused by
the release, validate, and (opt-in) e2e/preview workflows:

```bash
MYTOOL_BIN=/tmp/mytool-linux-x64 \
EXPECTED_VERSION=2026.06.12 \
scripts/smoke-release-asset.sh
```

Set `MYTOOL_SMOKE_ROOT` to keep scratch state under a known directory and
`MYTOOL_SMOKE_DIAG_DIR` to copy failure diagnostics for artifact upload.

The smoke contract is deliberately small for a self-contained CLI:

- `mytool --version` matches `EXPECTED_VERSION` (a leading `v` is stripped),
- `mytool --help` prints usage and exits zero,
- the example subcommand (`mytool hello`) runs and greets.

As your engine grows real behavior, extend the smoke with a lifecycle that
exercises it — a real end-to-end check, not
merely "it didn't crash."

## Failure artifacts

On failure, the release workflow writes diagnostics for the failed asset
(command output, `--version`/`--help`, environment details) to the job summary,
and the post-publish workflow uploads them as a short-lived artifact, so a
download/checksum problem is distinguishable from a binary startup failure.
