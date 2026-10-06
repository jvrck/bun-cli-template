# Running mytool

## Prerequisites

- [Bun](https://bun.sh) `>=1.3.9` — only to run from source or build; a released
  binary needs nothing.

The example engine has no runtime executable dependencies. If you add commands
that shell out, list those tools here.

## Run from source

```bash
bun install
bun run mytool -- --help
```

Arguments after `--` are passed to `mytool`:

```bash
bun run mytool -- hello
bun run mytool -- hello Ada --json
```

## Install globally from source

```bash
bun link
mytool --help
```

This puts a `mytool` on `PATH` that runs `src/index.ts` under Bun. To compile a
standalone single-file executable instead, see [building.md](./building.md).

## Install a release binary (no Bun)

For a host that just needs to run `mytool` without a Bun toolchain, install a
standalone binary from a GitHub Release with `install.sh`.

**Public repo** — no credentials needed:

```bash
curl -fsSL https://raw.githubusercontent.com/jvrck/bun-cli-template/main/install.sh | bash
```

**Private repo** — fetch the installer with an authenticated `gh` (raw URLs of
private repos are not anonymously readable); the installer then downloads with
the same `gh` login, or with `GH_TOKEN`/`GITHUB_TOKEN` (for CI):

```bash
gh api repos/jvrck/bun-cli-template/contents/install.sh -H 'Accept: application/vnd.github.raw' | bash
```

The installer detects your OS/arch (glibc vs musl), downloads the matching
`mytool-<os>-<arch>` asset and the release's `SHA256SUMS`, verifies the
checksum, confirms the binary runs and reports the release version, and installs
to `$HOME/.local/bin/mytool` by staging a temporary file next to it and renaming
it into place (`mv -f`). Any failure leaves an existing install untouched;
re-running is an in-place upgrade. musl is detected on x86_64 only (the release
has no arm64 musl build).

| Variable | Default | Meaning |
| --- | --- | --- |
| `MYTOOL_VERSION` | `latest` | a CalVer tag (e.g. `2026.10.06`) or `latest` |
| `MYTOOL_REPO` | `jvrck/bun-cli-template` | the repo to install from |
| `MYTOOL_INSTALL_AUTH` | `auto` | `auto` (anonymous, then `gh`, then token), `anonymous`, `gh`, or `token` |
| `BIN_DIR` | `$HOME/.local/bin` | install directory |
| `MYTOOL_DOWNLOAD_BASE`, `MYTOOL_API_BASE` | `https://github.com`, `https://api.github.com` | base URLs, for mirrors and tests |

Pass variables to the piped script with `env`, for example
`curl -fsSL …/install.sh | env MYTOOL_VERSION=2026.10.06 bash`.

The token is sent only as a request header to the GitHub API (never on the
command line, and not to the storage host that serves the download). With the
default `https` endpoints the installer refuses redirects to plain `http`.
Requirements on the target host: `bash`, `curl` (7.58 or newer for the token
channel), and `sha256sum` or `shasum`; `gh` only for the `gh` channel.

`SHA256SUMS` is published in the same release as the binaries, so the checksum
detects corrupt or truncated downloads; it is not a signature and cannot detect
a compromised release.

## Example commands

```bash
mytool hello
mytool hello Ada --json
mytool --version
```

See [commands.md](./commands.md) for the full reference and the `--json`
contract.
