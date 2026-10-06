# Releasing mytool

Releases are published as GitHub Releases attached to CalVer git tags. Assets
of a public repo download anonymously; a private repo needs GitHub
authentication (`gh` or a token) — `install.sh` supports both.

## Version scheme

Release tags use zero-padded CalVer dates:

```text
YYYY.MM.DD
```

Example: `2026.06.12`. Tags do not use a `v` prefix. For a second release on the
same day, append a numeric micro segment:

```text
YYYY.MM.DD.N
```

Example: `2026.06.12.2`. Compare versions numerically and component-wise, not as
strings and not as semver: `2026.06.12.10` is newer than `2026.06.12.2`.

Source runs are intentionally stamped `0.0.0-dev`. Release binaries are stamped
by the workflow with the tag value (via `bun build --define
process.env.MYTOOL_VERSION`), so `mytool --version` prints the bare CalVer
string.

## Cut a release

1. Ensure `main` has the commit to release and CI is green.
2. Update `CHANGELOG.md`: move the user-visible entries under `## Unreleased`
   into a new dated section named exactly for the tag, and open a fresh empty
   `## Unreleased`. **Publishing fails if the tag has no `CHANGELOG.md` section
   or an empty one** — that section IS the GitHub Release notes.
3. Pick the tag:

   ```bash
   TAG=$(date +%Y.%m.%d)        # or $(date +%Y.%m.%d).2 for a same-day re-release
   ```

4. Create and push the tag:

   ```bash
   git fetch --tags origin
   git tag "$TAG"
   git push origin "$TAG"
   ```

Pushing a `20[0-9][0-9].*` tag triggers `.github/workflows/release.yml`:

```text
create-release (draft) -> build x4 (upload to draft) -> validate-native + validate-linux-musl -> release (publish)
```

1. **create-release** checks the CalVer tag, extracts the tag's `CHANGELOG.md`
   section (failing before anything builds if it is missing or empty), and
   creates a **draft** release — or reuses an existing draft from a failed
   attempt.
2. **build** cross-compiles the four stamped binaries and uploads each to the
   draft. Binaries travel as draft-release assets, not Actions artifacts, so the
   account's artifact-storage quota cannot block a release.
3. **validate-native / validate-linux-musl** download each binary from the draft
   and smoke it on its native runner (Alpine for musl).
4. **release** generates and scans the CycloneDX SBOM, writes `SHA256SUMS` over
   the exact binaries plus the SBOM, verifies the draft carries **exactly** the
   expected six assets, publishes the draft as the latest release, and reads it
   back.

## Safeguards and recovery

- **Validate before publish.** Any failed build, validation, SBOM scan or asset
  check leaves the release as a draft; nothing is public until every job passes.
- **Published releases are never modified.** Every job that uploads or publishes
  first checks that the release is still a draft, and `create-release` refuses a
  tag whose release is already published. Re-running a job that writes after
  publication fails without touching public assets (re-running a validation
  job only reads).
- **Rebuilt assets are re-validated.** Re-running a single job in GitHub
  Actions also re-runs the jobs that depend on it, so a rebuilt binary goes
  through validation again before the publish job can run.
- **Exact asset set.** A missing or unexpected asset on the draft fails the
  publish job (`scripts/verify-release-assets.sh`); the draft is left for a human
  to inspect.
- **One run per tag.** A per-tag concurrency group prevents two release runs
  racing on the same draft, and a failed release lookup stops the run instead
  of creating a second draft.
- **"Latest" stays on the newest CalVer.** A release is marked Latest unless an
  already-published release has a higher CalVer (for example a late
  `YYYY.MM.DD.N` backport). `scripts/release-latest.sh` makes that decision and
  treats only a proven absence (HTTP 404: no published release yet) as "no
  Latest"; any other lookup failure (server error, auth or rate limit) fails the
  publish job and leaves the release as a draft — re-run that job later.
- **One publish at a time per repository.** The publish job runs in a
  repository-wide concurrency group and decides Latest inside it, so releases
  for different tags cannot read the same old Latest and publish out of order.
  GitHub keeps at most one running and one pending job per group; if another
  publish queues behind a pending one, the older pending job is cancelled and
  its release stays a draft until that job is re-run.

If a run fails before publishing, fix the cause and either **re-run the failed
jobs** (the draft is reused, its notes refreshed from `CHANGELOG.md`) or delete
the draft and tag and push a new tag (for example `YYYY.MM.DD.2`). To replace a
release that is already published, delete the release deliberately first —
the workflow will not do it for you.

## Assets

Each release contains exactly:

```text
mytool-linux-x64
mytool-linux-arm64
mytool-darwin-arm64
mytool-linux-x64-musl
sbom.cdx.json
SHA256SUMS
```

The binaries follow `mytool-<os>-<arch>`, with one libc-qualified Linux variant:

- `mytool-linux-x64` — x86_64 Linux on glibc (Debian/Ubuntu/Fedora/…).
- `mytool-linux-arm64` — ARM64 Linux on glibc.
- `mytool-darwin-arm64` — Apple Silicon macOS.
- `mytool-linux-x64-musl` — x86_64 musl (Alpine and other musl environments).
- `sbom.cdx.json` — CycloneDX SBOM, Trivy-gated (HIGH/CRITICAL fixable findings
  fail the release) before publishing.

There is no `darwin-x64` target.

## Verify a release

```bash
set -euo pipefail
TAG=2026.10.06
REPO=jvrck/bun-cli-template
dir="$(mktemp -d)"
# Public repo, no credentials:
for name in mytool-linux-x64 SHA256SUMS; do
  curl -fsSL -o "$dir/$name" "https://github.com/$REPO/releases/download/$TAG/$name"
done
# Private repo instead: gh release download "$TAG" -R "$REPO" -p mytool-linux-x64 -p SHA256SUMS -D "$dir"
( cd "$dir" && grep ' mytool-linux-x64$' SHA256SUMS | sha256sum -c - )
chmod +x "$dir/mytool-linux-x64" && "$dir/mytool-linux-x64" --version   # prints the tag
```

To re-validate the already-published assets, run the post-publish workflow:

```bash
gh workflow run validate-release.yml -f tag="$TAG"
```

See [release-validation.md](./release-validation.md).
