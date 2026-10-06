import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The release workflow's safety checks live in small scripts so they can be
// tested here instead of only on a real tag push.

const repoRoot = join(import.meta.dir, "..");
const verifyAssets = join(repoRoot, "scripts", "verify-release-assets.sh");
const extractNotes = join(repoRoot, "scripts", "extract-changelog-section.sh");
const releaseLatest = join(repoRoot, "scripts", "release-latest.sh");

function run(cmd: string[], stdin = "", env?: Record<string, string>) {
  const result = Bun.spawnSync(cmd, {
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: env ?? process.env,
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

const EXPECTED = ["mytool-linux-x64", "mytool-linux-arm64", "sbom.cdx.json", "SHA256SUMS"];

describe("scripts/verify-release-assets.sh", () => {
  test("accepts exactly the expected set, in any order", () => {
    const result = run(["bash", verifyAssets, ...EXPECTED], [...EXPECTED].reverse().join("\n"));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("verified release asset set");
  });

  test("rejects an unexpected extra asset", () => {
    const result = run(["bash", verifyAssets, ...EXPECTED], [...EXPECTED, "stray.bin"].join("\n"));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unexpected release asset 'stray.bin'");
  });

  test("rejects a missing asset", () => {
    const result = run(["bash", verifyAssets, ...EXPECTED], EXPECTED.slice(1).join("\n"));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("expected release asset missing: 'mytool-linux-x64'");
  });

  test("rejects an empty release", () => {
    const result = run(["bash", verifyAssets, ...EXPECTED], "");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("expected release asset missing");
  });

  test("requires an expected set", () => {
    expect(run(["bash", verifyAssets], "a\n").code).toBe(2);
  });
});

describe("scripts/extract-changelog-section.sh", () => {
  const dir = mkdtempSync(join(tmpdir(), "mytool-changelog-"));
  const changelog = join(dir, "CHANGELOG.md");
  writeFileSync(
    changelog,
    "# Changelog\n\n## Unreleased\n\n## 2026.10.06\n\n### Added\n\n- A thing.\n\n## 2026.10.05\n\n## 2026.10.04\n\n- Older.\n",
  );

  test("prints the section for the tag", () => {
    const result = run(["bash", extractNotes, "2026.10.06", changelog]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("- A thing.");
    expect(result.stdout).not.toContain("Older");
  });

  test("fails when the tag has no section (blocks the release before any build)", () => {
    const result = run(["bash", extractNotes, "2026.10.07", changelog]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("has no section for release tag 2026.10.07");
  });

  test("fails when the tag's section is empty", () => {
    const result = run(["bash", extractNotes, "2026.10.05", changelog]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("is empty");
  });
});

describe("scripts/release-latest.sh (Latest decision, fail closed)", () => {
  // A stub gh that answers `gh api -i repos/<repo>/releases/latest` the way the
  // real CLI does: status line + headers + body on stdout, exit 1 and a message
  // on stderr for non-2xx, and no stdout at all for a transport failure.
  const stubDir = mkdtempSync(join(tmpdir(), "mytool-latest-"));
  writeFileSync(
    join(stubDir, "gh"),
    `#!/bin/sh
[ "$1 $2 $3" = "api -i repos/acme/tool/releases/latest" ] || { echo "stub gh: unexpected: $*" >&2; exit 2; }
case "$STUB_STATUS" in
  none) echo "error connecting to api.github.com" >&2; exit 1 ;;
  200) printf 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"tag_name":"%s","draft":false}' "$STUB_TAG" ;;
  *) printf 'HTTP/2.0 %s Error\r\n\r\n{"message":"error"}' "$STUB_STATUS"; echo "gh: error (HTTP $STUB_STATUS)" >&2; exit 1 ;;
esac
`,
  );
  chmodSync(join(stubDir, "gh"), 0o755);

  const decide = (tag: string, status: string, current = "") =>
    run(["bash", releaseLatest, tag], "", {
      PATH: `${stubDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      GH_REPO: "acme/tool",
      STUB_STATUS: status,
      STUB_TAG: current,
    });

  test("first release (no published release: HTTP 404) becomes Latest", () => {
    const result = decide("2026.10.06", "404");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("true\n");
  });

  test("a newer tag becomes Latest", () => {
    expect(decide("2026.11.01", "200", "2026.10.06").stdout).toBe("true\n");
    expect(decide("2026.10.06.10", "200", "2026.10.06.2").stdout).toBe("true\n"); // numeric, not string order
  });

  test("an older (backport) tag is published without becoming Latest", () => {
    const result = decide("2026.10.06.1", "200", "2026.11.01");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("false\n");
  });

  test("re-publishing the current Latest keeps it Latest", () => {
    expect(decide("2026.10.06", "200", "2026.10.06").stdout).toBe("true\n");
  });

  test("an unknown lookup result fails closed with no decision", () => {
    for (const status of ["503", "500", "502", "401", "403", "429", "none"]) {
      const result = decide("2026.01.01", status);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("could not determine the current Latest release");
    }
  });

  test("an unreadable or non-CalVer current Latest fails closed", () => {
    expect(decide("2026.10.06", "200", "v1.2.3").code).toBe(1);
    expect(decide("2026.10.06", "200", "").code).toBe(1);
  });

  test("rejects a non-CalVer tag and a missing GH_REPO", () => {
    expect(decide("v2026.10.06", "404").code).toBe(1);
    const noRepo = run(["bash", releaseLatest, "2026.10.06"], "", { PATH: process.env.PATH ?? "/usr/bin:/bin" });
    expect(noRepo.code).toBe(1);
  });
});

describe(".github/workflows/release.yml", () => {
  const workflow = readFileSync(join(repoRoot, ".github", "workflows", "release.yml"), "utf8");

  test("the publish allowlist matches every asset the workflow builds and validates", () => {
    const matrixAssets = new Set([...workflow.matchAll(/^\s+(?:- )?asset: (\S+)$/gm)].map((m) => m[1]));
    const allowlist = workflow.match(/^\s+ASSETS: (.+)$/m)?.[1].trim().split(/\s+/) ?? [];
    expect(allowlist.length).toBe(4);
    expect(new Set(allowlist)).toEqual(matrixAssets);
  });

  test("binaries never travel through Actions artifacts", () => {
    expect(workflow).not.toMatch(/actions\/(upload|download)-artifact/);
  });

  test("every job that uploads or publishes checks the release is still a draft first", () => {
    const jobs = workflow.split(/^ {2}(?=[a-z-]+:$)/m).slice(1);
    const writers = jobs.filter((job) => /gh release (upload|edit)/.test(job));
    expect(writers.length).toBe(3); // create-release, build, release
    for (const job of writers) {
      const guard = job.search(/isDraft/);
      const write = job.search(/gh release (upload|edit)/);
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(write);
    }
    expect(workflow).toContain("concurrency:");
  });

  test("publishing is serialized across tags and decides Latest through the fail-closed script", () => {
    const publish = workflow.slice(workflow.indexOf("\n  release:\n"));
    expect(publish).toMatch(/concurrency:\n\s+group: release-publish-\$\{\{ github\.repository \}\}\n\s+cancel-in-progress: false/);
    expect(publish).toContain('make_latest="$(scripts/release-latest.sh "$TAG")"');
    expect(publish).not.toMatch(/\|\| true\)"\s*\n[^\n]*gh release edit/);
  });

  test("only an explicit 'release not found' leads to creating a release", () => {
    expect(workflow).toMatch(/elif grep -qx 'release not found'[^\n]*\n\s+gh release create/);
  });
});

describe("CHANGELOG.md", () => {
  const changelog = join(repoRoot, "CHANGELOG.md");
  const text = readFileSync(changelog, "utf8");

  test("keeps an Unreleased section for upcoming changes", () => {
    expect(text).toMatch(/^## Unreleased$/m);
  });

  test("every dated release section has notes (publishing would fail otherwise)", () => {
    const tags = [...text.matchAll(/^## (\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)$/gm)].map((m) => m[1]);
    for (const tag of tags) {
      expect(run(["bash", extractNotes, tag, changelog]).code).toBe(0);
    }
  });
});
