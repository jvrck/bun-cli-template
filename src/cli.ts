import { helloCommand } from "./commands/hello";
import { MytoolError, type MytoolErrorCode } from "./errors";
import type { CliIO } from "./runtime/io";
import { VERSION } from "./version";

export type { CliIO } from "./runtime/io";

const COMMANDS = ["hello"] as const;

type CommandName = (typeof COMMANDS)[number];

export interface GlobalOptions {
  help: boolean;
  version: boolean;
}

export interface ParsedGlobal {
  globals: GlobalOptions;
  command?: string;
  args: string[];
}

const ROOT_HELP = `mytool ${VERSION}

A minimal example CLI scaffolded from jvrck/bun-cli-template.

Usage:
  mytool <command> [args...]
  mytool --help
  mytool --version

Global options:
  -h, --help       Show help.
  -v, --version    Show version.

Commands:
  hello      Print a greeting (the example subcommand).
`;

const COMMAND_HELP: Record<CommandName, string> = {
  hello: `Usage:
  mytool hello [name] [--json]

Prints "Hello, <name>!" (default name: world). With --json it prints a
{"greeting","name"} envelope instead of the plain line. This is the template's
example subcommand — replace it with your tool's real commands.
`,
};

export function help(): string {
  return ROOT_HELP;
}

export function commandHelp(command: string): string | undefined {
  return isCommand(command) ? COMMAND_HELP[command] : undefined;
}

export function parseGlobal(rawArgs: string[]): ParsedGlobal {
  const args = [...rawArgs];
  const globals: GlobalOptions = { help: false, version: false };

  while (args.length > 0) {
    const arg = args[0];
    if (arg === "--help" || arg === "-h") {
      args.shift();
      globals.help = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      args.shift();
      globals.version = true;
      continue;
    }
    break;
  }

  return { globals, command: args.shift(), args };
}

export async function runCli(
  rawArgs: string[],
  io: CliIO = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  try {
    return dispatch(parseGlobal(rawArgs), io);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (jsonErrorRequested(rawArgs)) {
      io.stdout.write(`${JSON.stringify({ error: { code: errorCode(error), message } })}\n`);
    } else {
      io.stderr.write(`mytool: ${message}\n`);
    }
    return 1;
  }
}

function dispatch(parsed: ParsedGlobal, io: CliIO): number {
  const { globals, command, args } = parsed;

  if (globals.version) {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (!command || globals.help) {
    io.stdout.write(help());
    return 0;
  }

  if (!isCommand(command)) {
    if (command.startsWith("-")) throw new MytoolError("bad-args", `unknown option: ${command}`);
    throw new MytoolError("bad-args", `unknown command: ${command}`);
  }

  if (hasHelpRequest(args)) {
    io.stdout.write(COMMAND_HELP[command]);
    return 0;
  }

  switch (command) {
    case "hello": {
      // Everything after a `--` terminator is positional, never an option — so a
      // name that starts with "-" (e.g. `hello -- -weird`) is still accepted.
      const terminatorIndex = args.indexOf("--");
      const positionalsAfter = terminatorIndex === -1 ? [] : args.splice(terminatorIndex + 1);
      if (terminatorIndex !== -1) args.pop(); // drop the `--` separator itself
      const json = takeFlag(args, "--json");
      const name = takePositional(args) ?? positionalsAfter.shift();
      rejectUnknownOptions(args);
      const leftover = [...args, ...positionalsAfter];
      if (leftover.length > 0) throw new MytoolError("bad-args", `unexpected argument: ${leftover[0]}`);
      return helloCommand(name, { json }, io);
    }
  }
}

// Whether the invocation requested a JSON error envelope (a `--json` before any
// `--` terminator). Drives failures to the stdout envelope instead of stderr.
function jsonErrorRequested(rawArgs: string[]): boolean {
  const terminatorIndex = rawArgs.indexOf("--");
  const optionArgs = terminatorIndex === -1 ? rawArgs : rawArgs.slice(0, terminatorIndex);
  return optionArgs.includes("--json");
}

function errorCode(error: unknown): MytoolErrorCode {
  return error instanceof MytoolError ? error.code : "mytool-error";
}

function isCommand(command: string): command is CommandName {
  return COMMANDS.includes(command as CommandName);
}

function hasHelpRequest(args: string[]): boolean {
  const terminatorIndex = args.indexOf("--");
  const optionArgs = terminatorIndex === -1 ? args : args.slice(0, terminatorIndex);
  return optionArgs.includes("--help") || optionArgs.includes("-h");
}

function takeFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

// Take the leading positional argument if present. A value starting with "-" is
// left in place so it surfaces as an unknown option rather than a name.
function takePositional(args: string[]): string | undefined {
  if (args.length > 0 && !args[0].startsWith("-")) return args.shift();
  return undefined;
}

function rejectUnknownOptions(args: string[]): void {
  const unknown = args.find((arg) => arg.startsWith("-"));
  if (unknown) throw new MytoolError("bad-args", `unknown option: ${unknown}`);
}

export const __test = { dispatch, errorCode, jsonErrorRequested, parseGlobal, takeFlag };
