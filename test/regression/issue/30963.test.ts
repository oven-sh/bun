// https://github.com/oven-sh/bun/issues/30963
//
// Parsing `[{static{}` (a `static { ... }` block inside an object literal
// instead of a class body) tripped a debug_assert in the object-literal
// parser: the class-static-block branch in `parse_property.rs` fired on
// identifier + `{` alone, without checking that the enclosing context was
// actually a class, and returned a `Property` with neither `key` nor
// `value`. That violated the `prop.key.is_some() || prop.value.is_some()`
// invariant asserted at `parse_prefix.rs:870`, aborting the debug process
// with SIGILL. Release builds masked it because the assert is gated on
// `cfg!(debug_assertions)`, so the malformed AST fell through to the
// existing `expect(TCloseBrace)` error path and a user-facing syntax error
// was emitted anyway.
//
// The Zig sibling had the same un-gated branch; both are now gated on
// `opts.is_class`. Outside a class body `static` is now parsed as an
// ordinary identifier and the trailing `{` produces a normal syntax error.
//
// Run the parse in a subprocess so a reintroduction (debug-build SIGILL)
// doesn't tear down the in-process test runner.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent.each(["[{static{}", "({static{}})", "({static{};})", "({static{},})"])(
  "`static { ... }` in an object-literal position (%s) is a syntax error, not a parser crash",
  async source => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      // Bound the subprocess: without the fix, the debug build panics
      // (SIGILL) and should exit immediately; if it somehow hangs, we want
      // a clean `signalCode` rather than a bun-test runner timeout.
      timeout: 10_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Before the fix, the debug build aborted with SIGILL inside the
    // parser and never reached the syntax-error reporter — stderr carried
    // `panic: assertion failed: prop.key.is_some() || prop.value.is_some()`
    // and `signalCode === "SIGILL"`. After the fix the parser emits the
    // normal user-facing syntax error and the process exits cleanly with
    // a non-zero code.
    expect(stderr).toContain('Expected "}" but found "{"');
    expect(proc.signalCode).toBeNull();
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  },
);
