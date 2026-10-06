// Single source of truth for the mytool version.
//
// Stamped at release build time via `bun build --define
// 'process.env.MYTOOL_VERSION="<tag>"'` (see docs/releasing.md). Source/dev runs
// fall back to a non-CalVer sentinel so tooling can tell a dev build from a real
// release.
export const VERSION = process.env.MYTOOL_VERSION ?? "0.0.0-dev";

// ---- CalVer helpers ---------------------------------------------------------
//
// mytool versions are CalVer `YYYY.MM.DD` with optional `.N` micro segments for
// same-day re-releases (e.g. `2026.06.12.2`). They are compared numerically
// component-wise, never as strings or semver, so `2026.06.12.10` > `2026.06.12.2`.

// Parse a CalVer string into its numeric components, or null if it is not a
// release version (e.g. the `0.0.0-dev` sentinel or a `0.0.0-preview.<sha>`
// build).
export function parseCalVer(value: string): number[] | null {
  if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)*$/.test(value)) return null;
  return value.split(".").map((part) => Number.parseInt(part, 10));
}

// Component-wise numeric comparison; shorter versions are padded with zeros so
// `2026.06.12` < `2026.06.12.2`.
export function compareCalVer(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

export function isReleaseVersion(value: string): boolean {
  return parseCalVer(value) !== null;
}
