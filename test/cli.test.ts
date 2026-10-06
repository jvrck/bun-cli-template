import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { VERSION } from "../src/version";

const repoRoot = join(import.meta.dir, "..");
const entry = join(repoRoot, "src", "index.ts");

// Spawn the real source CLI (`bun run src/index.ts ...`) and capture its
// observable behavior end to end (arg parse -> dispatch -> output / exit code).
async function mytool(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", entry, ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

describe("mytool CLI (spawned source)", () => {
  test(
    "--version prints the stamped version on stdout and exits 0",
    async () => {
      const result = await mytool(["--version"]);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`${VERSION}\n`);
    },
    30000,
  );

  test(
    "--help prints usage with the command surface and carries no host/session leftovers",
    async () => {
      const result = await mytool(["--help"]);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("mytool");
      expect(result.stdout).toContain("Usage:");
      expect(result.stdout).toContain("hello");
      // Guard against scaffold-origin machinery leaking into the surface: a fresh
      // template engine has no sessions, hosts, skills, or MCP concepts.
      expect(result.stdout).not.toContain("tmux");
      expect(result.stdout).not.toContain("--host");
      expect(result.stdout).not.toContain("--remote");
      expect(result.stdout).not.toContain("skills");
      expect(result.stdout).not.toContain("mcp");
    },
    30000,
  );

  test(
    "no-args prints help and exits 0",
    async () => {
      const result = await mytool([]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage:");
      expect(result.stdout).toContain("hello");
    },
    30000,
  );

  test(
    "hello greets the world by default",
    async () => {
      const result = await mytool(["hello"]);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("Hello, world!\n");
    },
    30000,
  );

  test(
    "hello <name> greets that name",
    async () => {
      const result = await mytool(["hello", "Ada"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("Hello, Ada!\n");
    },
    30000,
  );

  test(
    "hello --json emits a {greeting,name} envelope on stdout",
    async () => {
      const result = await mytool(["hello", "Ada", "--json"]);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout) as { greeting: string; name: string };
      expect(parsed).toEqual({ greeting: "Hello, Ada!", name: "Ada" });
    },
    30000,
  );

  test(
    "hello honors a -- terminator (the rest is positional, even a leading dash)",
    async () => {
      const plain = await mytool(["hello", "--", "Ada"]);
      expect(plain.code).toBe(0);
      expect(plain.stdout).toBe("Hello, Ada!\n");

      const dashName = await mytool(["hello", "--", "-weird"]);
      expect(dashName.code).toBe(0);
      expect(dashName.stdout).toBe("Hello, -weird!\n");

      const withJson = await mytool(["hello", "--json", "--", "Ada"]);
      expect(withJson.code).toBe(0);
      expect(JSON.parse(withJson.stdout)).toEqual({ greeting: "Hello, Ada!", name: "Ada" });

      // A flag-looking token AFTER the terminator is a literal name, not the
      // --json flag, and must not trigger the JSON envelope.
      const flagAfterTerminator = await mytool(["hello", "--", "--json"]);
      expect(flagAfterTerminator.code).toBe(0);
      expect(flagAfterTerminator.stdout).toBe("Hello, --json!\n");

      // A name before AND after the terminator is two positionals -> bad-args.
      const twoNames = await mytool(["hello", "a", "--", "b"]);
      expect(twoNames.code).not.toBe(0);
      expect(twoNames.stderr).toContain("unexpected argument");
      expect(twoNames.stderr).not.toContain("at "); // no JS stack frames leaked
    },
    30000,
  );

  test(
    "an unknown command fails cleanly with a stable bad-args message (no crash)",
    async () => {
      const result = await mytool(["bogus-command"]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("mytool:");
      expect(result.stderr).toContain("unknown command");
      expect(result.stderr).not.toContain("at "); // no JS stack frames leaked
    },
    30000,
  );

  test(
    "an unknown command with --json writes the frozen error envelope to stdout",
    async () => {
      const result = await mytool(["bogus-command", "--json"]);
      expect(result.code).not.toBe(0);
      const parsed = JSON.parse(result.stdout) as { error?: { code?: string; message?: string } };
      expect(parsed.error?.code).toBe("bad-args");
      expect(typeof parsed.error?.message).toBe("string");
      expect(parsed.error?.message?.length ?? 0).toBeGreaterThan(0);
    },
    30000,
  );
});
