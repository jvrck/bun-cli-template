# Building mytool

## Build a standalone binary

```bash
bun run build
```

This runs `bun build src/index.ts --compile --outfile dist/mytool` and produces a
single-file executable at `dist/mytool`. `dist/` is git-ignored.

## Put it on PATH

```bash
cp dist/mytool ~/.local/bin/mytool   # or any directory on your PATH
mytool --version
```

## Cross-compile

Pass `--target` to compile for another platform:

```bash
bun build src/index.ts --compile --target=bun-linux-x64 --outfile dist/mytool-linux-x64
bun build src/index.ts --compile --target=bun-darwin-arm64 --outfile dist/mytool-darwin-arm64
```

The release workflow builds four targets: `bun-linux-x64`, `bun-linux-arm64`,
`bun-darwin-arm64`, and `bun-linux-x64-musl`.

## Release builds

The tag-driven release workflow cross-compiles the supported release assets and
stamps each binary with the CalVer tag via
`--define "process.env.MYTOOL_VERSION=<tag>"`. A source/dev build is unstamped
and reports `0.0.0-dev`. See [releasing.md](./releasing.md) for the runbook and
asset-naming convention, and [building.md](./building.md)'s sibling
[release-validation.md](./release-validation.md) for how each asset is validated.

## Bun version baseline

The supported minimum is Bun `1.3.9` (`engines.bun` in `package.json`). CI,
release and preview builds pin exactly that version, so every test, build and
released binary proves the minimum. `@types/bun` may track newer releases for
editor support; that is safe only while the code avoids APIs the minimum lacks.
Type-checking cannot catch such use; the tests and build running on 1.3.9 catch
it only where they exercise that code. Raise the minimum deliberately — `engines`, the
`bun-version` pins in every workflow, and the docs together.

## Runtime dependencies

`--compile` bundles the whole Bun/JS side, and the example engine shells out to
nothing, so the released binary is **self-contained** — no Bun, no runtime
executables required on the target host. If you add commands that shell out (to
`git`, `gh`, etc.), document those as runtime dependencies and add a presence
check to `install.sh` (the template ships none by default).
