import { describe, expect, test } from "bun:test";
import {
  evaluate,
  findings,
  type InstalledPackage,
  installedPackagesFrom,
  type LicenseFinding,
  lockfileIdentities,
  splitIdentity,
} from "../scripts/license-policy";

// Shapes below are copied from real trivy 0.71 / Bun 1.3.9 output for a
// fixture with two versions of one package (ms@2.1.3 at the top level and
// ms@2.0.0 nested under debug) and a scoped package (@types/ms).
const installed: InstalledPackage[] = [
  { name: "@types/ms", version: "0.7.34", filePath: "@types/ms/package.json" },
  { name: "debug", version: "2.6.9", filePath: "debug/package.json" },
  { name: "ms", version: "2.0.0", filePath: "debug/node_modules/ms/package.json" },
  { name: "ms", version: "2.1.3", filePath: "ms/package.json" },
];
const lockfile = ["@types/ms@0.7.34", "debug@2.6.9", "ms@2.0.0", "ms@2.1.3"];
const mit = (pkg: string, filePath: string): LicenseFinding => ({
  pkg,
  license: "MIT",
  category: "notice",
  severity: "LOW",
  filePath,
});
const allLicensed = [
  mit("@types/ms", "@types/ms/package.json"),
  mit("debug", "debug/package.json"),
  mit("ms", "debug/node_modules/ms/package.json"),
  mit("ms", "ms/package.json"),
];
const without = (filePath: string) => allLicensed.filter((f) => f.filePath !== filePath);

describe("license coverage per exact package version", () => {
  test("passes when every lockfile version has a permissive license", () => {
    const verdict = evaluate(lockfile, allLicensed, installed, allLicensed);
    expect(verdict.ok).toBe(true);
    expect(verdict.uncovered).toEqual([]);
  });

  test("duplicate versions: a license on one version does not cover the other", () => {
    const reported = without("debug/node_modules/ms/package.json");
    const verdict = evaluate(lockfile, reported, installed, reported);
    expect(verdict.ok).toBe(false);
    expect(verdict.uncovered).toEqual(["ms@2.0.0"]);
  });

  test("scoped package identities keep their scope", () => {
    const reported = without("@types/ms/package.json");
    const verdict = evaluate(lockfile, reported, installed, reported);
    expect(verdict.uncovered).toEqual(["@types/ms@0.7.34"]);
  });

  test("an exact-version review covers only that version", () => {
    const reported = without("debug/node_modules/ms/package.json");
    const reviewed = { "ms@2.0.0": "owner: @maintainer; MIT upstream; review: 2027-01-01" };
    const verdict = evaluate(lockfile, reported, installed, reported, reviewed);
    expect(verdict.ok).toBe(true);
    expect(verdict.reviewedUndetected).toEqual(["ms@2.0.0"]);

    // After an upgrade the lockfile names a different version: the old review
    // does not carry over.
    const upgraded = evaluate(["ms@2.0.1"], [], [], [], reviewed);
    expect(upgraded.ok).toBe(false);
    expect(upgraded.uncovered).toEqual(["ms@2.0.1"]);
  });

  test("a scoped exact-version review works; a blank note does not", () => {
    const reported = without("@types/ms/package.json");
    expect(evaluate(lockfile, reported, installed, reported, { "@types/ms@0.7.34": "owner: @me; reviewed" }).ok).toBe(true);
    expect(evaluate(lockfile, reported, installed, reported, { "@types/ms@0.7.34": "  " }).ok).toBe(false);
  });

  test("a name-only review key is rejected and covers nothing", () => {
    const reported = without("debug/node_modules/ms/package.json");
    for (const key of ["ms", "@types/ms", "ms@"]) {
      const verdict = evaluate(lockfile, reported, installed, reported, { [key]: "owner: @me; reviewed" });
      expect(verdict.ok).toBe(false);
      expect(verdict.invalidReviews).toEqual([key]);
    }
  });

  test("a review note never hides a flagged license", () => {
    const gpl: LicenseFinding = { ...mit("ms", "ms/package.json"), license: "GPL-3.0", category: "restricted", severity: "HIGH" };
    const reported = [...without("ms/package.json"), gpl];
    const verdict = evaluate(lockfile, reported, installed, reported, { "ms@2.1.3": "owner: @me; reviewed" });
    expect(verdict.ok).toBe(false);
    expect(verdict.flagged).toEqual([gpl]);
  });

  test("a reviewed .trivyignore exception (dropped from the effective scan) still counts as covered", () => {
    const gpl: LicenseFinding = { ...mit("ms", "ms/package.json"), license: "GPL-3.0", category: "restricted", severity: "HIGH" };
    const all = [...without("ms/package.json"), gpl];
    const verdict = evaluate(lockfile, all, installed, without("ms/package.json"));
    expect(verdict.ok).toBe(true);
  });

  test("flags reciprocal, restricted, forbidden and unknown licenses for review", () => {
    const reported = (["MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"] as const).map((severity) => ({
      ...mit("ms", "ms/package.json"),
      severity,
    }));
    const verdict = evaluate(["ms@2.1.3"], reported, installed, reported);
    expect(verdict.ok).toBe(false);
    expect(verdict.flagged.length).toBe(4);
  });
});

describe("unmapped or ambiguous license findings fail closed", () => {
  test("a finding whose manifest path has no package record", () => {
    const stray = mit("ms", "elsewhere/ms/package.json");
    const verdict = evaluate(lockfile, [...allLicensed, stray], installed, allLicensed);
    expect(verdict.ok).toBe(false);
    expect(verdict.unmapped).toEqual(["ms (elsewhere/ms/package.json)"]);
  });

  test("a finding whose package record has a different name", () => {
    const wrong = mit("not-ms", "ms/package.json");
    const verdict = evaluate(lockfile, [...allLicensed, wrong], installed, allLicensed);
    expect(verdict.unmapped).toEqual(["not-ms (ms/package.json)"]);
  });

  test("two package records for one manifest path", () => {
    const twice = [...installed, { name: "ms", version: "9.9.9", filePath: "ms/package.json" }];
    const verdict = evaluate(lockfile, allLicensed, twice, allLicensed);
    expect(verdict.ok).toBe(false);
    expect(verdict.unmapped).toEqual(["ms (ms/package.json)"]);
    expect(verdict.uncovered).toEqual(["ms@2.1.3"]);
  });

  test("a finding without a manifest path, or a record without a version", () => {
    expect(evaluate(lockfile, [...allLicensed, mit("ms", "")], installed, allLicensed).unmapped).toEqual(["ms (no manifest path)"]);
    const noVersion = installed.map((p) => (p.filePath === "ms/package.json" ? { ...p, version: "" } : p));
    expect(evaluate(lockfile, allLicensed, noVersion, allLicensed).unmapped).toEqual(["ms (ms/package.json)"]);
  });
});

describe("identities", () => {
  test("splitIdentity handles scoped and unscoped names", () => {
    expect(splitIdentity("ms@2.0.0")).toEqual({ name: "ms", version: "2.0.0" });
    expect(splitIdentity("@types/ms@0.7.34")).toEqual({ name: "@types/ms", version: "0.7.34" });
    expect(splitIdentity("@types/ms")).toBeUndefined();
    expect(splitIdentity("ms")).toBeUndefined();
    expect(splitIdentity("ms@")).toBeUndefined();
  });

  test("lockfileIdentities reads every bun.lock entry, including nested versions", () => {
    // Text bun.lock as Bun 1.3.9 writes it (JSONC with trailing commas).
    const lock = `{
  "lockfileVersion": 1,
  "workspaces": { "": { "name": "fixture", "dependencies": { "ms": "2.1.3", "debug": "2.6.9", "@types/ms": "0.7.34", }, }, },
  "packages": {
    "@types/ms": ["@types/ms@0.7.34", "", {}, "sha512-x"],
    "debug": ["debug@2.6.9", "", { "dependencies": { "ms": "2.0.0" } }, "sha512-y"],
    "ms": ["ms@2.1.3", "", {}, "sha512-z"],
    "debug/ms": ["ms@2.0.0", "", {}, "sha512-w"],
  }
}`;
    expect(lockfileIdentities(lock)).toEqual(lockfile);
  });

  test("lockfileIdentities fails on an entry it cannot identify", () => {
    expect(() => lockfileIdentities('{ "packages": { "x": ["x", "", {}] } }')).toThrow("no name@version identity");
    expect(() => lockfileIdentities('{ "packages": { "x": {} } }')).toThrow("no name@version identity");
  });
});

describe("trivy report parsing", () => {
  // Real `trivy rootfs --scanners license --list-all-pkgs node_modules` layout:
  // one lang-pkgs result (versions + paths) and one license result (findings
  // with package name + path, no version).
  const report = {
    Results: [
      {
        Target: "Node.js",
        Class: "lang-pkgs",
        Packages: [
          { Name: "ms", Version: "2.0.0", FilePath: "debug/node_modules/ms/package.json" },
          { Name: "@types/ms", Version: "0.7.34", FilePath: "@types/ms/package.json" },
        ],
      },
      {
        Target: "Node.js",
        Class: "license",
        Licenses: [
          { PkgName: "ms", FilePath: "debug/node_modules/ms/package.json", Name: "MIT", Category: "notice", Severity: "LOW" },
        ],
      },
    ],
  };

  test("reads installed package records with version and path", () => {
    expect(installedPackagesFrom(report)).toEqual([
      { name: "ms", version: "2.0.0", filePath: "debug/node_modules/ms/package.json" },
      { name: "@types/ms", version: "0.7.34", filePath: "@types/ms/package.json" },
    ]);
    expect(installedPackagesFrom({})).toEqual([]);
  });

  test("reads license findings with their manifest path", () => {
    expect(findings(report)).toEqual([mit("ms", "debug/node_modules/ms/package.json")]);
  });
});
