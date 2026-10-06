# mytool commands

Reference for every mytool command. For install and a quickstart see the
[README](../README.md); for running from source see [running.md](./running.md).

The template engine has **one example command**, `hello`, plus the global
`--version` / `--help`. Replace `hello` with your tool's real commands; keep the
global surface and the `--json` agent contract below.

## Global options

```bash
mytool --version    # prints the stamped version (0.0.0-dev from source)
mytool --help       # prints usage and the command list
mytool              # no args also prints help, exits 0
```

`-h`/`-v` are accepted aliases. An unknown command or option fails with a clean
`bad-args` error and a nonzero exit — never a stack trace.

## hello

```bash
mytool hello              # Hello, world!
mytool hello Ada          # Hello, Ada!
mytool hello Ada --json   # {"greeting":"Hello, Ada!","name":"Ada"}
```

`hello [name]` greets `name` (default `world`). It exists to prove the engine,
the `--json` agent surface, and the test harness — delete it once you have real
commands.

## Machine-readable output (`--json`)

`--json` is the agent surface. A command that supports it prints a structured
result on success and a single **error envelope** on failure:

```json
{"error":{"code":"bad-args","message":"unknown command: bogus"}}
```

The envelope shape `{"error":{"code","message"}}` is frozen. The `message` is the
same human text the non-`--json` path prints to **stderr**; `code` is a stable
machine token. Agents may match on `code` without parsing prose.

Stable codes in the template engine:

| code | meaning |
|---|---|
| `bad-args` | missing/invalid arguments or flags |
| `mytool-error` | a generic command failure not given a more specific code |

Add codes to `MytoolErrorCode` in `src/errors.ts` as commands grow; existing
codes keep their meaning. Route a failure to the JSON envelope by throwing a
`MytoolError` from the command and ensuring `--json` is present before any `--`
terminator.
