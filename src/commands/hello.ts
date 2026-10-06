import type { CliIO } from "../runtime/io";

export interface HelloOptions {
  json: boolean;
}

// The template's one example subcommand. `mytool hello [name]` greets `name`
// (default "world"); `--json` emits a `{"greeting","name"}` envelope instead of
// the plain line. Replace this with your tool's real commands — it exists to
// prove the engine, the `--json` agent surface, and the test harness all work.
export function helloCommand(name: string | undefined, options: HelloOptions, io: CliIO): number {
  const who = name ?? "world";
  const greeting = `Hello, ${who}!`;
  if (options.json) {
    io.stdout.write(`${JSON.stringify({ greeting, name: who })}\n`);
  } else {
    io.stdout.write(`${greeting}\n`);
  }
  return 0;
}
