# Branch and PR Previews (opt-in tier)

This tier is **parked** — inert until you enable it (see
[`optional/README.md`](../README.md)). Preview builds let agents and developers
test a branch or PR before it is released. They are **not** releases, do not
update `latest`, and are stamped `0.0.0-preview.<short-sha>` (never CalVer), so a
self-upgrade path would refuse them.

## Preview Types

1. **Source checkout preview** — run `mytool` from a checked-out branch with Bun.
2. **GitHub Actions artifact preview** — download compiled binaries built by
   `preview.yml`.

## Source Checkout Preview

```bash
git fetch origin <branch-or-pr-ref>
git worktree add ../mytool-preview <branch-or-pr-ref>
cd ../mytool-preview
bun install --frozen-lockfile
bun run typecheck
bun test
bun run mytool -- --version   # prints 0.0.0-dev
git rev-parse HEAD            # the real preview identity
```

## GitHub Actions Artifact Preview

`preview.yml` builds preview artifacts from the requested ref. It runs
`bun run typecheck`, `bun test`, cross-compiles the same four asset names used by
releases, writes `BUILD_INFO.json` + `SHA256SUMS`, and uploads one bundle named
`mytool-preview-<safe-ref>-<short-sha>`. Inside the bundle, binary names match
release asset names so the same smoke + platform-selection rules apply.

```bash
gh workflow run preview.yml -R <owner>/<repo> --ref main -f ref=<branch-or-sha>
RUN_ID="$(gh run list -R <owner>/<repo> --workflow preview.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run download "$RUN_ID" -R <owner>/<repo> -D /tmp/mytool-preview
```

Verify the bundle (`sha256sum -c SHA256SUMS`), then smoke a downloaded binary
with the shared release smoke:

```bash
PREVIEW_BIN=/tmp/mytool-preview/.../mytool-linux-x64
MYTOOL_BIN="$PREVIEW_BIN" \
  EXPECTED_VERSION="$("$PREVIEW_BIN" --version)" \
  MYTOOL_SMOKE_ROOT="$(mktemp -d)" \
  scripts/smoke-release-asset.sh
```

## When to enable

Enable previews when you hand branch builds to agents or testers who need the
exact source SHA as an installable binary before a release exists. Do not report
a preview as a release: a preview version is never CalVer.
