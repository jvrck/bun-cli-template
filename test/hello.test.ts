import { describe, expect, test } from "bun:test";
import { helloCommand } from "../src/commands/hello";

// Capture the CLI's output streams so a command can be exercised directly,
// without spawning a process. This is the unit-level companion to the spawned
// end-to-end checks in cli.test.ts.
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
    },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

describe("helloCommand", () => {
  test("greets the world by default", () => {
    const cap = capture();
    const code = helloCommand(undefined, { json: false }, cap.io);
    expect(code).toBe(0);
    expect(cap.out()).toBe("Hello, world!\n");
    expect(cap.err()).toBe("");
  });

  test("greets a named argument", () => {
    const cap = capture();
    const code = helloCommand("Ada", { json: false }, cap.io);
    expect(code).toBe(0);
    expect(cap.out()).toBe("Hello, Ada!\n");
  });

  test("emits a {greeting,name} envelope under --json", () => {
    const cap = capture();
    const code = helloCommand("Ada", { json: true }, cap.io);
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out()) as { greeting: string; name: string };
    expect(parsed).toEqual({ greeting: "Hello, Ada!", name: "Ada" });
  });
});
