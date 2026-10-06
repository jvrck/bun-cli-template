# Contributing

Thanks for helping improve the template. Issues and pull requests are welcome.

## Before you start

- **Bugs and small fixes** — open a pull request directly, or an issue if you
  want to discuss it first.
- **New features** — open an issue first. The template keeps a deliberately
  small active core (`ci`, `release`, `validate-release`, `security`); heavier
  capabilities belong in the opt-in tier under [`optional/`](optional/README.md),
  and a generator CLI, sync service or new platform targets are out of scope.
- **Security issues** — do not open a public issue; follow [SECURITY.md](SECURITY.md).

## Development

Requires [Bun](https://bun.sh) `>=1.3.9`. CI and release builds pin Bun
**1.3.9**, the supported minimum; please verify changes against it.

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
```

The installer tests run `install.sh` against a local mock server and need a
host with a published asset (Linux x64/arm64 or macOS arm64).

If you change workflows or shell scripts, also run
[`actionlint`](https://github.com/rhysd/actionlint) and
[`shellcheck`](https://www.shellcheck.net/):

```bash
actionlint .github/workflows/*.yml optional/*.yml
shellcheck install.sh scripts/*.sh
```

Type definitions (`@types/bun`) may be newer than the minimum runtime. Do not
use Bun APIs that the minimum runtime lacks; CI's tests and build run on 1.3.9
to catch that.

## Pull requests

- Keep each PR focused on one change, with a conventional title
  (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
- Add or update tests for behavior changes.
- Add a user-facing entry under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md).
- Keep the template generic: no organization-specific hosts, credentials or
  workflows, and keep the `mytool` sentinel rename-safe (see
  [docs/scaffolding.md](docs/scaffolding.md)) — if you add a file or variable
  containing the sentinel, add it to the checklist.
- Required checks must pass: `check`, `HIGH/CRITICAL fixable gate` and
  `License policy flag`.

Automated or AI-assisted review is welcome but optional; it does not replace the
required checks or a maintainer's review.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE) that covers this project.
