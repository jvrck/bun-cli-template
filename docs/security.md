# Security Scanning

mytool uses OSV-Scanner and Trivy as its dependency security baseline. The repo
keeps the **text** `bun.lock` lockfile; do not replace it with `bun.lockb`,
because the security workflows scan the text lockfile.

## Dependabot remediation

Dependabot complements the OSV/Trivy detection and merge gates with an
automated repair path. Vulnerability alerts identify affected resolved
dependencies, and automated security fixes may open a security PR as soon as a
remediation is available. Those security PRs remain eligible even when the fix
requires a major version change.

`.github/dependabot.yml` separately schedules routine Bun and GitHub Actions
version updates every Monday in `Australia/Sydney`. Each ecosystem groups its
routine minor and patch updates into one PR. Routine major updates are excluded
by the version-update-only allow rule so they remain deliberate human work; do
not replace that rule with a Dependabot `ignore` rule, because `ignore` also
filters security updates.

Review Dependabot PRs with the normal CI and `HIGH/CRITICAL fixable gate`.
Dependabot does not merge PRs automatically, and it does not change the
scanner, severity, license, or suppression policies documented below.

## Local scans

Install the pinned CI scanner versions, then run the same commands locally:

```bash
bun run security:install
bun run security:osv
bun run security:trivy
bun run security:gate
bun run security:sbom
bun run security:sbom:scan
```

`security:gate` is the blocking policy: HIGH and CRITICAL findings with available
fixes fail the command. Lower severities and unfixed findings remain reporting
signals unless the policy changes. `security:osv` scans `bun.lock` with
`--config=osv-scanner.toml`; the Trivy commands scan the filesystem with dev
dependencies included and honor `.trivyignore.yaml`. Those two files are the only
suppression sources.

## CI behavior

`.github/workflows/security.yml` runs on pull requests, pushes to `main` and
`epic/**`, a weekly schedule, and manual dispatch. It holds
`permissions: contents: read`, and has three jobs:

- **`Dependency scan (reporting)`** — reporting mode. The OSV and Trivy steps are
  `continue-on-error`, and the SARIF upload is best-effort (`if: always()` +
  `continue-on-error`, so an artifact-storage-quota failure can't redden the
  job). It never blocks a merge.
- **`HIGH/CRITICAL fixable gate`** — blocks PR/push/manual runs on HIGH or
  CRITICAL fixable Trivy findings (`--severity HIGH,CRITICAL --ignore-unfixed
  --exit-code 1`). Every dependency of the template is a dev dependency, so the
  scans pass `--include-dev-deps`; without it Trivy would scan nothing.
- **`License policy flag`** — installs dependencies and runs
  `bun run security:licenses` (below). Fails when a dependency needs a human
  license review.

> **Required-checks wedge (important).** Make **only** the blocking jobs required
> status checks — `check` (CI), `HIGH/CRITICAL fixable gate` and
> `License policy flag`. Keep the
> `Dependency scan (reporting)` job **out** of required checks: a
> `continue-on-error` reporting job can surface as failed-but-continued and would
> wedge the merge gate if required.

## Dependency-license policy flag

`bun run security:licenses` (`scripts/license-policy.ts`) is a **review flag,
not a legal determination**. It uses Trivy's license classification, which is a
heuristic: passing does not certify that a dependency's license is compatible
with this project's MIT license or with how you distribute your tool, and
failing does not mean it is incompatible. It means a person should look.

How it works:

- `bun.lock` carries no license metadata, so the check scans the **installed**
  packages (`node_modules`, after `bun install --frozen-lockfile`) with
  `trivy rootfs --scanners license`.
- Coverage is per **exact package version**. Every `name@version` that
  `bun.lock` resolves (including nested duplicates such as two versions of one
  package) must have at least one detected license on an installed package of
  exactly that name and version. An undetected license fails instead of passing
  silently, and a license on one version never covers another. A package
  version that is not installed on the runner (an optional, platform-specific
  dependency) or that declares no license needs a recorded review instead
  (below).
- Each license finding is tied to the installed `package.json` it came from
  and, through the same scan's package record, to a name and version. A finding
  that cannot be mapped to exactly one installed package version fails the
  check rather than counting as coverage.
- Every detected license must fall in Trivy's permissive / notice /
  unencumbered categories (severity `LOW`). Reciprocal (e.g. MPL), restricted
  (e.g. GPL), forbidden and unidentified licenses fail for review.

After reviewing a flagged dependency, record the decision as a `licenses:`
entry in `.trivyignore.yaml` scoped to the package's `package.json` (path
relative to `node_modules`), with owner, reason and a review date in
`statement` — the same discipline as vulnerability suppressions:

```yaml
licenses:
  - id: MPL-2.0
    paths:
      - "some-package/package.json"
    statement: "owner: @maintainer; tracking issue: #123; reason: reviewed, file-level copyleft only; review: 2027-01-01"
```

For a package version with no detectable license, record the review in
`package.json` under its exact `name@version` (scoped names keep their scope,
e.g. `@scope/pkg@1.2.3`). A bare package name is rejected, so a review never
silently covers a later version: after an upgrade the new version needs its own
review. The note must be non-empty and never overrides a flagged license:

```json
"licenseReview": {
  "undetected": {
    "some-optional-dep@1.4.2": "owner: @maintainer; reason: macOS-only optional dependency, MIT upstream; review: 2027-01-01"
  }
}
```

## Release SBOM

The tag-triggered release workflow generates `sbom.cdx.json` with Trivy in
CycloneDX format, scans it for HIGH/CRITICAL fixable vulnerabilities before
publishing (`security:sbom:scan`), and uploads it alongside the binaries and
`SHA256SUMS`. A failing SBOM scan blocks the release.

## Suppressions

Suppression files are versioned: `osv-scanner.toml` and `.trivyignore.yaml`.
Every suppression must include an advisory ID, a reason, an owner, a tracking
issue or note, and an expiry/review date. For OSV use `ignoreUntil` with
owner/tracking in `reason`; for Trivy use `expired_at` with owner/tracking in
`statement`. A suppression with no expiry, owner, or tracking reference is not
allowed — it converts a known finding into a silent one.
