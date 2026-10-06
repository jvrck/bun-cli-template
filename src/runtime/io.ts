// Minimal output sink the CLI writes through, so commands can be unit-tested
// with captured buffers instead of the real process streams.
export interface CliIO {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}
