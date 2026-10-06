# Scaffolding checklist

This is the checklist for turning a fresh repository created from
`bun-cli-template` into your own tool. It is exhaustive on purpose: if a swap
point is missing, a leftover sentinel shows up in the verify step (§5), and this
file should be fixed until a literal rename produces a green build.

The template's tool name appears in **three case forms**, each meaningful:

| Form | Means | Examples |
| --- | --- | --- |
| `mytool` | the bin / package name (and the asset prefix `mytool-<os>-<arch>`, and the `mytool-error` fallback code) | `package.json` `name`/`bin`, `dist/mytool`, `mytool-linux-x64` |
| `MYTOOL` | the env-var prefix | `MYTOOL_VERSION`, `MYTOOL_REPO`, `MYTOOL_INSTALL_AUTH`, `MYTOOL_BIN`, `MYTOOL_SMOKE_ROOT`, `MYTOOL_SECURITY_TOOLS_DIR` |
| `Mytool` | PascalCase identifiers | `MytoolError`, `MytoolErrorCode` (`src/errors.ts`, `src/cli.ts`) |

Plus the **repo slug** `jvrck/bun-cli-template`, and the free-text **author**
and **description** in `package.json`.

> The commands below spell the sentinel split (`my''tool`, `jvrck''/…`) so that
> they still mean the same thing after the bulk rename rewrites this file.

## 1. Bulk rename (the mechanical core)

Run this from the repo root of your new repository. It rewrites every tracked
text file except the lockfile (regenerated in step 3), then renames any tracked
path that contains the sentinel. `perl -i` is used for macOS/Linux portability.

```bash
TOOL=probe                 # lowercase bin/package name
TOOL_UPPER=PROBE           # env-var prefix (usually TOOL upper-cased)
TOOL_PASCAL=Probe          # PascalCase identifier stem
SLUG=my-org/probe          # your GitHub repo slug (owner/repo)

# Contents
git ls-files | grep -vx 'bun.lock' | while read -r f; do
  perl -pi \
    -e "s#jvrck""/bun-cli-template#$SLUG#g;" \
    -e "s/my""tool/$TOOL/g;" \
    -e "s/MY""TOOL/$TOOL_UPPER/g;" \
    -e "s/My""tool/$TOOL_PASCAL/g;" \
    "$f"
done

# Paths (the stock template has none; this catches any you added)
git ls-files | { grep -E 'my''tool|MY''TOOL|My''tool' || true; } | while read -r f; do
  new="$(printf '%s' "$f" | perl -pe "s/my""tool/$TOOL/g; s/MY""TOOL/$TOOL_UPPER/g; s/My""tool/$TOOL_PASCAL/g")"
  mkdir -p "$(dirname "$new")"
  git mv "$f" "$new"
done
```

> The repo-slug substitution runs first (it contains no sentinel). The three
> case forms are case-sensitive and do not overlap.

Then set the free-text identity (don't pattern-swap these):

- `package.json` → `"author"` and `"description"`.
- `LICENSE` → **keep** the existing `Copyright (c) 2026 Jim Vrckovski` line —
  the MIT license requires the original notice to stay with copies and
  substantial portions. Add your own line for your work, for example:

  ```text
  Copyright (c) 2026 Jim Vrckovski
  Copyright (c) 2026 Your Name
  ```

## 2. Per-file swap points (verify the bulk rename covered these)

| File | What to confirm |
| --- | --- |
| `package.json` | `name`, `bin.<tool>`, the `<tool>` run script, `repository.url`, `description`, `author`. The `security:*` scripts need no change. |
| `src/index.ts` | shebang only — no swap. |
| `src/version.ts` | `process.env.<TOOL_UPPER>_VERSION`, the `0.0.0-dev` fallback, comments. |
| `src/errors.ts` | `<Pascal>Error`, `<Pascal>ErrorCode`, the `<tool>-error` fallback code. |
| `src/cli.ts` | `<Pascal>Error` imports/uses, root + command help text, `<tool>:` stderr prefix. |
| `src/commands/hello.ts` | the example command — replace it with your real commands once renamed. |
| `test/*.test.ts` | spawned-CLI assertions, the env sentinel, the genericization guard (`--help` must not contain `tmux`/`--host`/`--remote`/`skills`/`mcp`), the installer's `<TOOL_UPPER>_*` variables and `<tool>-<os>-<arch>` fixtures. |
| `install.sh` | `<TOOL_UPPER>_REPO` default = your slug, `<TOOL_UPPER>_VERSION` / `_INSTALL_AUTH` / `_DOWNLOAD_BASE` / `_API_BASE`, the `<tool>` bin name, the `<tool>-<os>-<arch>` asset detection. |
| `.github/workflows/release.yml` | the build-matrix asset names `<tool>-<os>-<arch>`, the publish job's `ASSETS` allowlist (must match the matrix), the four `bun-*` targets, `--define "process.env.<TOOL_UPPER>_VERSION=…"`, the smoke env (`<TOOL_UPPER>_BIN` etc.). |
| `.github/workflows/validate-release.yml` | asset names, smoke env, the Alpine `/tmp/<tool>` paths. |
| `.github/workflows/ci.yml`, `.github/workflows/security.yml` | no tool name in the body. |
| `.github/dependabot.yml` | no swap; adjust the schedule `timezone` to yours. |
| `scripts/smoke-release-asset.sh` | `<TOOL_UPPER>_BIN`, `<TOOL_UPPER>_SMOKE_*`, the installed-bin name, the example-subcommand assertion (`hello`). |
| `scripts/install-security-tools.sh` | `<TOOL_UPPER>_SECURITY_TOOLS_DIR`. |
| `scripts/extract-changelog-section.sh`, `scripts/verify-release-assets.sh`, `scripts/release-latest.sh`, `scripts/license-policy.ts` | no swap (generic). |
| `docs/*.md` | tool name, env vars, the repo slug in install/quickstart snippets. |
| `SECURITY.md` | the advisory link now points at your repo; enable private vulnerability reporting (§6) or replace the route. |
| `CONTRIBUTING.md` | review the checks and conventions; keep or adapt. |
| `optional/*` | asset names, env, the `mytool mcp` example in `optional/docs/mcp.md` — only matters once you enable a tier. |
| `README.md` | rewrite as your tool's README (step 4). |
| `CHANGELOG.md` | reset to your tool's initial `## Unreleased` entry. |
| `LICENSE` | keep the original notice; add yours (step 1). |

## 3. Regenerate the lockfile

`bun.lock` carries the package name; regenerate it rather than hand-editing:

```bash
rm -f bun.lock
bun install        # writes a fresh text bun.lock (never bun.lockb)
```

## 4. Rewrite the narrative files

These are content, not mechanical swaps:

- `README.md` — what your tool is, install, quickstart, command reference link.
- `CHANGELOG.md` — a single `## Unreleased` section describing the initial state.
- `docs/commands.md` — your real command surface (replace the `hello` example).

## 5. Verify

```bash
set -euo pipefail
SENTINEL='my''tool|MY''TOOL|My''tool|jvrck''/bun-cli-template'

# No sentinel survivors in tracked file contents or paths (expect "clean" twice):
if git grep -nE "$SENTINEL" -- .; then echo "FAIL: survivors above"; exit 1; else echo "contents clean"; fi
if git ls-files | grep -E "$SENTINEL"; then echo "FAIL: paths above"; exit 1; else echo "paths clean"; fi

# The original MIT notice is intact:
grep -q 'Copyright (c) 2026 Jim Vrckovski' LICENSE

# Build + test green (use the runtime pinned in CI, bun 1.3.9, to prove the minimum):
bun install --frozen-lockfile && bun run typecheck && bun test && bun run build
./dist/"$TOOL" --version

# Workflows parse:
actionlint .github/workflows/*.yml   # https://github.com/rhysd/actionlint
```

A clean grep plus a green build is the definition of a complete rename. If the
grep finds a survivor that the bulk rename missed, add it to step 2.

## 6. Repository settings templates do not copy

Creating a repository from a template copies files only. Apply these yourself
(`OWNER_REPO=my-org/probe`):

- **Branch protection on `main`** — require the blocking checks `check`,
  `HIGH/CRITICAL fixable gate` and `License policy flag`; keep
  `Dependency scan (reporting)` **out** (it is `continue-on-error` and would
  wedge merges). Disallow force-pushes and deletion.

  ```bash
  gh api -X PUT "repos/$OWNER_REPO/branches/main/protection" --input - <<'JSON'
  {"required_status_checks":{"strict":false,"contexts":["check","HIGH/CRITICAL fixable gate","License policy flag"]},
   "enforce_admins":false,"required_pull_request_reviews":{"required_approving_review_count":0},"restrictions":null,
   "required_conversation_resolution":true,"allow_force_pushes":false,"allow_deletions":false}
  JSON
  ```

- **Workflow token default** — read-only; the release workflow elevates per job:
  `gh api -X PUT "repos/$OWNER_REPO/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false`
- **Dependabot** — alerts and security updates:
  `gh api -X PUT "repos/$OWNER_REPO/vulnerability-alerts"` and
  `gh api -X PUT "repos/$OWNER_REPO/automated-security-fixes"`.
- **Secret scanning and push protection** (available on public repos):

  ```bash
  gh api -X PATCH "repos/$OWNER_REPO" --input - <<'JSON'
  {"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
  JSON
  ```

- **Private vulnerability reporting** (public repos; the route `SECURITY.md`
  points to): `gh api -X PUT "repos/$OWNER_REPO/private-vulnerability-reporting"`.
- **About** — description, topics, homepage: `gh repo edit "$OWNER_REPO" --description "…" --add-topic cli`.
- **Unused features** — turn off what you don't use, e.g.
  `gh repo edit "$OWNER_REPO" --enable-wiki=false --enable-projects=false`.
- **Template flag** — a derived tool is not a template unless you want it to be:
  `gh repo edit "$OWNER_REPO" --template=false`.
- **Releases and tags are not copied** — your first CalVer tag is your first
  release ([releasing.md](./releasing.md)).
- **Private repos** — release validation uses GitHub-hosted Linux arm64 and
  macOS runners, which consume Actions minutes at higher rates for private
  repositories; installs need `gh` auth or a token (see
  [running.md](./running.md#install-a-release-binary-no-bun)).
