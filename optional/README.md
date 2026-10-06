# Opt-in tier

The template ships a **lean active core** — `ci` · `release` · `validate-release`
· `security` — that every tool wants. This directory parks the **heavy tier**:
useful for some tools, overkill for most. Everything here is **inert** (GitHub
only runs workflows under `.github/workflows/`, and nothing imports these docs),
so it costs nothing until you copy it in.

This honors "complete, not maximal": the standard is explicit about what is core
versus opt-in, instead of shipping every workflow on every repo.

## Tiers

| Tier | Files | Enable when |
| --- | --- | --- |
| **e2e** | `e2e.yml`, `docs/e2e.md` | your CLI grows real side effects worth a per-PR binary lifecycle smoke |
| **preview** | `preview.yml`, `docs/previews.md` | you hand branch/PR builds to agents or testers as installable binaries before a release |
| **mcp** | `docs/mcp.md` | you want an MCP client to drive your tool (adds the MCP SDK dep + a `mytool mcp` command) |

## Enable the e2e tier

```bash
cp optional/e2e.yml .github/workflows/e2e.yml
cp optional/docs/e2e.md docs/e2e.md
```

Then link `docs/e2e.md` from your README/docs index. The workflow reuses
`scripts/smoke-release-asset.sh`, which is already in the core.

## Enable the preview tier

```bash
cp optional/preview.yml .github/workflows/preview.yml
cp optional/docs/previews.md docs/previews.md
```

No new dependencies — it cross-compiles the same four assets as `release.yml`,
stamped `0.0.0-preview.<short-sha>`.

## Enable the mcp tier

The mcp tier is not a copy-one-file switch — it adds a runtime surface:

1. `bun add @modelcontextprotocol/sdk`
2. Implement `src/commands/mcp.ts` (an stdio MCP server) and wire `mcp` into the
   dispatcher in `src/cli.ts`. See `optional/docs/mcp.md` for the sketch.
3. `cp optional/docs/mcp.md docs/mcp.md` and link it from your docs.
4. Add tests for the new command and update `CHANGELOG.md`.

## After enabling

- Run `actionlint .github/workflows/*.yml` and `bun test`.
- Add the new workflow's blocking jobs (if any) to your branch-protection
  required checks; keep any `continue-on-error` reporting jobs **out** of
  required checks.
- Update `docs/scaffolding.md` if the tier introduced new swap points.
