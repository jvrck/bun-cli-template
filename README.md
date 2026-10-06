# bun-cli-template

A starter for small **Bun + TypeScript command-line tools** that ship as
self-contained single-file binaries. Create a repo from this template, run one
rename, and you have a working CLI with tests, CalVer releases for four
platforms, checksummed downloads, an installer, dependency scanning and a docs
set — all of it already green.

The template is itself a working minimal CLI (`mytool`), so nothing is a dead
placeholder: it builds, tests and releases as-is.

## Create your CLI

1. **Create a repo from the template** — the **Use this template** button on
   GitHub, or:

   ```bash
   gh repo create my-org/my-tool --template jvrck/bun-cli-template --public --clone
   cd my-tool
   ```

   (`--private` works too; the installer supports private repos.)

2. **Rename the tool** with the checklist in
   [`docs/scaffolding.md`](docs/scaffolding.md): one scripted find-replace of
   the `mytool` / `MYTOOL` / `Mytool` sentinel and the repo slug, a path rename,
   and a lockfile regeneration. A clean sentinel check plus a green build is the
   definition of done.

3. **Build and run it** (requires [Bun](https://bun.sh) `>=1.3.9`):

   ```bash
   bun install
   bun test
   bun run build
   ./dist/my-tool --version     # 0.0.0-dev from a source build
   ./dist/my-tool hello Ada --json
   ```

4. **Make it yours**: replace the `hello` example in `src/commands/` with real
   commands, rewrite this README and `CHANGELOG.md`, and apply the repository
   settings that templates do not copy
   ([scaffolding §6](docs/scaffolding.md#6-repository-settings-templates-do-not-copy)).

5. **Release**: add a dated section to `CHANGELOG.md`, push a CalVer tag
   (`git tag 2026.10.06 && git push origin 2026.10.06`), and the release
   workflow builds, validates and publishes. See
   [`docs/releasing.md`](docs/releasing.md).

## What you get

- **A real minimal engine** — stamped `--version`, `--help`, and one example
  subcommand (`hello [name]`) with a `--json` agent surface and a frozen
  `{"error":{"code","message"}}` envelope, plus tests.
- **CalVer tag-driven releases** — four stamped, self-verifying binaries
  (`<tool>-linux-x64`, `-linux-arm64`, `-linux-x64-musl`, `-darwin-arm64`), a
  scanned CycloneDX SBOM and `SHA256SUMS`. Binaries are staged on a **draft**
  release, validated on native runners (and Alpine for musl), and published
  only when the exact expected asset set is present. Published releases are
  never overwritten.
- **An installer** (`install.sh`) — anonymous HTTPS for public repos, with
  `gh` or `GH_TOKEN` authentication for private ones; mandatory checksum
  verification and an atomic in-place upgrade.
- **Dependency hygiene** — OSV-Scanner + Trivy (a blocking HIGH/CRITICAL
  fixable gate plus non-blocking reporting), a dependency-license review flag,
  grouped Dependabot updates, and keep-a-changelog release notes.
- **A lean active core** — `ci` · `release` · `validate-release` · `security`
  — and an **opt-in tier** (`e2e` · `preview` · `mcp`) parked under
  [`optional/`](optional/README.md), inert until you copy it in.

## Install a released binary

Users of a tool built from this template install it with its `install.sh`
(no Bun needed on the target host). For the template's own example CLI:

```bash
curl -fsSL https://raw.githubusercontent.com/jvrck/bun-cli-template/main/install.sh | bash
```

Private repos, pinned versions and the other options are covered in
[`docs/running.md`](docs/running.md#install-a-release-binary-no-bun).

## Documentation

- [docs/scaffolding.md](docs/scaffolding.md) — the rename checklist and repository settings
- [docs/running.md](docs/running.md) — run from source, install a release binary
- [docs/building.md](docs/building.md) — compile a standalone binary, cross-compile
- [docs/commands.md](docs/commands.md) — command reference and the `--json` contract
- [docs/releasing.md](docs/releasing.md) — the CalVer release flow and its safeguards
- [docs/release-validation.md](docs/release-validation.md) — how each asset is validated
- [docs/security.md](docs/security.md) — dependency scanning, license flag, suppressions
- [docs/agent-skill.md](docs/agent-skill.md) — an optional operating spec for coding agents
- [optional/README.md](optional/README.md) — enabling the e2e / preview / mcp tiers

## Contributing and security

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please
report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Jim Vrckovski. Tools created from this template keep the
original copyright notice in `LICENSE` and may add their own.
