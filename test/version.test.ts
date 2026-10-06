import { describe, expect, test } from "bun:test";
import { compareCalVer, isReleaseVersion, parseCalVer, VERSION } from "../src/version";

describe("parseCalVer", () => {
  test("parses a plain YYYY.MM.DD tag into numeric components", () => {
    expect(parseCalVer("2026.06.08")).toEqual([2026, 6, 8]);
  });

  test("parses same-day micro segments", () => {
    expect(parseCalVer("2026.06.12.2")).toEqual([2026, 6, 12, 2]);
    expect(parseCalVer("2026.06.12.10")).toEqual([2026, 6, 12, 10]);
  });

  test("returns null for non-release sentinels", () => {
    expect(parseCalVer("0.0.0-dev")).toBeNull();
    expect(parseCalVer("0.0.0-preview.abc1234")).toBeNull();
  });

  test("returns null for malformed or non-zero-padded values", () => {
    expect(parseCalVer("2026.6.8")).toBeNull(); // month/day not zero-padded
    expect(parseCalVer("v2026.06.08")).toBeNull(); // no v prefix allowed
    expect(parseCalVer("2026.06")).toBeNull(); // incomplete
    expect(parseCalVer("2026.06.08.")).toBeNull(); // trailing dot
    expect(parseCalVer("")).toBeNull();
    expect(parseCalVer("not-a-version")).toBeNull();
  });
});

describe("compareCalVer", () => {
  test("orders by year, then month, then day", () => {
    expect(compareCalVer([2025, 12, 31], [2026, 1, 1])).toBe(-1);
    expect(compareCalVer([2026, 6, 8], [2026, 6, 7])).toBe(1);
    expect(compareCalVer([2026, 6, 8], [2026, 6, 8])).toBe(0);
  });

  test("compares micro segments numerically, not as strings", () => {
    // The locked spec: `2026.06.12.10` > `2026.06.12.2`.
    const a = parseCalVer("2026.06.12.10")!;
    const b = parseCalVer("2026.06.12.2")!;
    expect(compareCalVer(a, b)).toBe(1);
    expect(compareCalVer(b, a)).toBe(-1);
  });

  test("pads shorter versions with zeros so a base tag precedes its micro", () => {
    const base = parseCalVer("2026.06.12")!;
    const micro = parseCalVer("2026.06.12.2")!;
    expect(compareCalVer(base, micro)).toBe(-1);
    expect(compareCalVer(micro, base)).toBe(1);
  });
});

describe("isReleaseVersion", () => {
  test("accepts CalVer release tags", () => {
    expect(isReleaseVersion("2026.06.08")).toBe(true);
    expect(isReleaseVersion("2026.06.12.2")).toBe(true);
  });

  test("rejects dev, preview, and malformed versions", () => {
    expect(isReleaseVersion("0.0.0-dev")).toBe(false);
    expect(isReleaseVersion("0.0.0-preview.abc1234")).toBe(false);
    expect(isReleaseVersion("2026.6.8")).toBe(false);
  });
});

describe("VERSION", () => {
  test("source/dev runs stamp the non-release sentinel", () => {
    // No MYTOOL_VERSION is stamped in a source/test run, so VERSION must be the
    // sentinel and must NOT be treated as a release.
    expect(VERSION).toBe("0.0.0-dev");
    expect(isReleaseVersion(VERSION)).toBe(false);
  });
});
