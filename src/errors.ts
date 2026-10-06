// Stable machine-readable error codes for the CLI's `--json` envelope.
//
// The envelope shape `{"error":{"code","message"}}` is the agent surface: a
// `--json` failure writes exactly that to stdout and exits nonzero, while the
// human path prints the same `message` to stderr. Add codes as commands grow;
// existing codes keep their meaning.
export type MytoolErrorCode = "bad-args" | "mytool-error";

export class MytoolError extends Error {
  readonly code: MytoolErrorCode;

  constructor(code: MytoolErrorCode, message: string) {
    super(message);
    this.name = "MytoolError";
    this.code = code;
  }
}
