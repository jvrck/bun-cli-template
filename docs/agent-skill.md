# Agent operating spec: mytool

This is an optional, agent-neutral operating spec for driving `mytool` (and any
tool scaffolded from this template) from a coding agent. Nothing in the template
depends on it, and no particular agent or review tool is assumed — adapt it into
whatever skill or instruction format your harness uses, or delete it.

`mytool` is a self-contained single-binary CLI: a clean, installable executable
that reports identity (`--version`), help (`--help`), and exposes a stable
`--json` agent surface for any command that produces a result.

## Discovery

Before doing real work, confirm how the CLI resolves and what version is present:

```bash
command -v mytool
mytool --version      # CalVer tag on a release; 0.0.0-dev from source
mytool --help
```

Report the resolved binary path and version. A source/dev build reports
`0.0.0-dev`; a real release reports a bare CalVer string.

## The `--json` agent surface

Drive commands with `--json` and treat the structured output — not the exit code
alone — as ground truth.

- On success, a `--json` command prints its structured result to stdout.
- On failure, it prints a single frozen error envelope to stdout and exits
  nonzero:

  ```json
  {"error":{"code":"bad-args","message":"..."}}
  ```

  Match on the stable `code` token, not the prose `message`. The non-`--json`
  path prints the same message to stderr instead.

```bash
mytool hello Ada --json        # {"greeting":"Hello, Ada!","name":"Ada"}
mytool bogus --json            # {"error":{"code":"bad-args","message":"unknown command: bogus"}}
```

## Build-phase awareness

A tool scaffolded from this template starts with one example command (`hello`).
As real commands land, an unimplemented path should return a clean error envelope
(add a `not-implemented` code to `MytoolErrorCode`) and a nonzero exit — never a
crash. Before relying on a command, confirm it is implemented for the installed
version rather than assuming, and report `not-implemented` plainly instead of
working around it with raw shell.

## Composition, not connection

`mytool` does the one job its commands name; it does not own your scheduler,
notifier, or storage. Compose it with ordinary tools:

```bash
mytool hello Ada --json | jq -r .greeting
```

Do not expect a notify/upload flag inside the tool; the `--json` envelope is the
signal and the rest of the pipeline is yours.

## Reporting

When you run `mytool`, report:

- the resolved binary path and version (and whether it was a source or release
  build);
- the exact invocation and target;
- the `--json` result, or the `{code, message}` envelope on failure;
- whether the exit code and the structured result agreed.

## Verification (when editing this spec)

```bash
set -euo pipefail
test -f docs/agent-skill.md
grep -q 'command -v mytool' docs/agent-skill.md
grep -q 'mytool --version' docs/agent-skill.md
grep -Eqi 'json' docs/agent-skill.md
# The CLI surface carries no scaffold-origin machinery:
mytool --help | grep -Eqi 'tmux|--host|--remote|skills|mcp' && { echo "leftover machinery in --help"; exit 1; } || true
bun run typecheck
bun test
```
