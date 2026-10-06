# Changelog

Release notes in this file are human-curated and user-facing. Keep each release
section focused on behavior, operations, compatibility, and upgrade impact rather
than duplicating the full PR log.

This changelog begins at the first tagged release. The `## Unreleased` section
accumulates user-facing changes between releases; at release time it is promoted
to a dated CalVer section (`YYYY.MM.DD`) and a fresh empty `## Unreleased` is
opened. The CalVer section for a tag IS that release's notes — publishing fails
if a tag has no section or an empty one.

## Unreleased

## 2026.10.06

First public release of the template under the MIT license.

### Added

- A working minimal Bun + TypeScript CLI (`mytool`) with a stamped
  `--version`, `--help`, one example subcommand (`hello [name]`) with a
  `--json` agent surface and a frozen `{"error":{"code","message"}}` envelope,
  and tests.
- CalVer tag-driven releases of four stamped, self-verifying binaries
  (`mytool-linux-x64`, `-linux-arm64`, `-linux-x64-musl`, `-darwin-arm64`) with
  a scanned CycloneDX SBOM and `SHA256SUMS`. Binaries are staged on a draft
  release, validated on native runners (Alpine for musl), and published only
  with the exact expected asset set; published releases are never modified,
  one release run proceeds per tag, and publishing is serialized per repository
  with a fail-closed "Latest" decision that never moves Latest to an older
  CalVer.
- `install.sh`: anonymous HTTPS installs from public repos, with `gh` or
  `GH_TOKEN`/`GITHUB_TOKEN` for private repos (`MYTOOL_INSTALL_AUTH`);
  mandatory checksum verification, a pre-install `--version` check and an
  atomic upgrade that never replaces a working install on failure.
- OSV-Scanner + Trivy dependency scanning (blocking HIGH/CRITICAL fixable gate,
  non-blocking reporting), a dependency-license review flag
  (`bun run security:licenses`), and grouped weekly Dependabot updates with
  security updates always eligible.
- `docs/scaffolding.md`: a rename checklist for contents and paths that keeps
  the original MIT notice and lists the repository settings templates do not
  copy; the `docs/` set; `CONTRIBUTING.md` and `SECURITY.md`.
- An opt-in tier (`e2e`, `preview`, `mcp`) parked under `optional/`.

### Compatibility

- Requires Bun `>=1.3.9` to build from source; CI and release builds pin 1.3.9.
  Released binaries are self-contained.
