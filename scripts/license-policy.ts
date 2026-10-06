#!/usr/bin/env bun
// Dependency-license review flag.
//
// Trivy cannot read licenses from bun.lock (the lockfile carries none), so a
// lockfile-only license scan passes vacuously. This scans the INSTALLED packages
// (node_modules, after `bun install --frozen-lockfile`) and checks coverage
// against the lockfile, per exact package version:
//   - every `name@version` in bun.lock must have at least one detected license
//     on an installed package of exactly that name and version, and
//   - every detected license must be in one of Trivy's permissive / notice /
//     unencumbered categories (reported as severity LOW).
// Anything else fails so a human reviews it.
//
// Identity: the lockfile's `name@version` comes from bun.lock itself (Trivy's
// bun.lock parser mis-reads nested entries such as `debug/ms`). A license
// finding carries only a package name and the manifest path it came from, so
// it is mapped through that path to the package record (name + version) of the
// same scan. A finding whose path has no record, a record with a different
// name, or two records for one path is unmapped and fails the check.
//
// This is a POLICY FLAG, not a legal determination: Trivy's license categories
// are heuristics, and passing or failing says nothing definitive about
// compatibility with this project's license or your use of a dependency.
//
// Reviewed exceptions:
//   - a flagged license: a `licenses:` entry in .trivyignore.yaml (package path
//     relative to node_modules; owner / reason / review date in `statement`).
//     Trivy drops that finding; the package still counts as covered because
//     coverage is measured on an unfiltered scan.
//   - a package version with no detectable license (e.g. an optional,
//     platform-specific dependency that is not installed on the CI runner): an
//     entry in package.json → "licenseReview": { "undetected": {
//     "<name>@<version>": "<owner, reason, review date>" } }. Keys must name an
//     exact version (a bare name is rejected, so an upgrade needs a new review)
//     and the note must be non-empty.
//
// Usage: bun scripts/license-policy.ts   (or: bun run security:licenses)

import { existsSync, readFileSync } from "node:fs";

export interface LicenseFinding {
  pkg: string;
  license: string;
  category: string;
  severity: string;
  filePath: string;
}

export interface InstalledPackage {
  name: string;
  version: string;
  filePath: string;
}

export interface LicenseVerdict {
  ok: boolean;
  uncovered: string[];
  unmapped: string[];
  flagged: LicenseFinding[];
  reviewedUndetected: string[];
  invalidReviews: string[];
}

// Split `name@version` at the last "@" that is not the leading scope marker.
export function splitIdentity(identity: string): { name: string; version: string } | undefined {
  const at = identity.lastIndexOf("@");
  if (at <= 0) return undefined;
  const name = identity.slice(0, at);
  const version = identity.slice(at + 1);
  return name !== "" && version !== "" ? { name, version } : undefined;
}

// Every `name@version` that bun.lock resolves (its `packages` entries start
// with that identity string). Throws on an entry it cannot identify.
export function lockfileIdentities(lockText: string): string[] {
  const lock = Bun.JSONC.parse(lockText) as { packages?: Record<string, unknown> };
  const identities = new Set<string>();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    const identity = Array.isArray(entry) ? entry[0] : undefined;
    if (typeof identity !== "string" || splitIdentity(identity) === undefined) {
      throw new Error(`bun.lock entry "${key}" has no name@version identity`);
    }
    identities.add(identity);
  }
  return [...identities].sort();
}

// Pure policy. `all` is the unfiltered scan (coverage) and `installed` its
// package records; `effective` is the scan with .trivyignore.yaml applied
// (policy); `reviewed` maps exact `name@version` to a review note.
export function evaluate(
  lockfile: string[],
  all: LicenseFinding[],
  installed: InstalledPackage[],
  effective: LicenseFinding[],
  reviewed: Record<string, string> = {},
): LicenseVerdict {
  const byPath = new Map<string, InstalledPackage[]>();
  for (const pkg of installed) byPath.set(pkg.filePath, [...(byPath.get(pkg.filePath) ?? []), pkg]);

  const covered = new Set<string>();
  const unmapped = new Set<string>();
  for (const finding of all) {
    const records = byPath.get(finding.filePath) ?? [];
    const record = records.length === 1 ? records[0] : undefined;
    if (!record || finding.filePath === "" || record.name !== finding.pkg || record.version === "") {
      unmapped.add(`${finding.pkg} (${finding.filePath || "no manifest path"})`);
      continue;
    }
    covered.add(`${record.name}@${record.version}`);
  }

  const invalidReviews = Object.keys(reviewed)
    .filter((key) => splitIdentity(key) === undefined)
    .sort();
  const isReviewed = (identity: string) =>
    typeof reviewed[identity] === "string" && reviewed[identity].trim() !== "";
  const missing = [...new Set(lockfile)].filter((identity) => !covered.has(identity)).sort();
  const uncovered = missing.filter((identity) => !isReviewed(identity));
  const reviewedUndetected = missing.filter(isReviewed);
  const flagged = effective.filter((finding) => finding.severity !== "LOW");
  return {
    ok: uncovered.length === 0 && unmapped.size === 0 && flagged.length === 0 && invalidReviews.length === 0,
    uncovered,
    unmapped: [...unmapped].sort(),
    flagged,
    reviewedUndetected,
    invalidReviews,
  };
}

export interface TrivyReport {
  Results?: {
    Target?: string;
    Class?: string;
    Packages?: { Name: string; Version?: string; FilePath?: string }[];
    Licenses?: { PkgName: string; Name: string; Category: string; Severity: string; FilePath?: string }[];
  }[];
}

function trivy(args: string[]): TrivyReport {
  const result = Bun.spawnSync(["trivy", ...args, "--format", "json", "--quiet"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`trivy ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return JSON.parse(result.stdout.toString()) as TrivyReport;
}

// Installed package records (name, version, manifest path) from a
// `trivy rootfs --list-all-pkgs` report.
export function installedPackagesFrom(report: TrivyReport): InstalledPackage[] {
  return (report.Results ?? []).flatMap((result) =>
    (result.Packages ?? []).map((pkg) => ({ name: pkg.Name, version: pkg.Version ?? "", filePath: pkg.FilePath ?? "" })),
  );
}

// License findings from a `trivy rootfs --scanners license` report.
export function findings(report: TrivyReport): LicenseFinding[] {
  return (report.Results ?? []).flatMap((result) =>
    (result.Licenses ?? []).map((l) => ({
      pkg: l.PkgName,
      license: l.Name,
      category: l.Category,
      severity: l.Severity,
      filePath: l.FilePath ?? "",
    })),
  );
}

function main(): number {
  if (!existsSync("node_modules")) {
    console.error("license-policy: node_modules is missing; run `bun install --frozen-lockfile` first");
    return 2;
  }
  const lockfile = lockfileIdentities(readFileSync("bun.lock", "utf8"));
  if (lockfile.length === 0) {
    console.error("license-policy: found no packages in bun.lock; refusing to report a vacuous pass");
    return 1;
  }
  const scan = trivy(["rootfs", "--scanners", "license", "--list-all-pkgs", "node_modules"]);
  const all = findings(scan);
  const effective = findings(
    trivy(["rootfs", "--scanners", "license", "--ignorefile", ".trivyignore.yaml", "node_modules"]),
  );
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    licenseReview?: { undetected?: Record<string, string> };
  };
  const verdict = evaluate(lockfile, all, installedPackagesFrom(scan), effective, manifest.licenseReview?.undetected ?? {});

  for (const identity of verdict.uncovered) {
    console.error(
      `::error::license-policy: no license detected for ${identity}; review it and record the decision under licenseReview.undetected["${identity}"] in package.json`,
    );
  }
  for (const finding of verdict.unmapped) {
    console.error(`::error::license-policy: license finding for ${finding} could not be mapped to one installed package version`);
  }
  for (const key of verdict.invalidReviews) {
    console.error(`::error::license-policy: licenseReview.undetected key "${key}" must name an exact version (name@version)`);
  }
  for (const identity of verdict.reviewedUndetected) {
    console.log(`license-policy: ${identity}: no detectable license; accepted by review note in package.json`);
  }
  for (const f of verdict.flagged) {
    console.error(
      `::error::license-policy: ${f.pkg} (${f.filePath}) is licensed ${f.license} (category ${f.category}, ${f.severity}); needs human review`,
    );
  }
  if (!verdict.ok) {
    console.error("license-policy: flagged for review (a policy flag, not a legal determination; see docs/security.md)");
    return 1;
  }
  console.log(
    `license-policy: ${lockfile.length} lockfile package versions, all with permissive/notice licenses (${all.length} findings)`,
  );
  return 0;
}

if (import.meta.main) process.exit(main());
