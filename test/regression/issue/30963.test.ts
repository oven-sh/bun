// https://github.com/oven-sh/bun/issues/30963
//
// Parsing `[{static{}` (a `static { ... }` block inside an object literal
// instead of a class body) tripped a debug_assert in the object-literal
// parser: the class-static-block branch in `parseProperty.zig` fired on
// identifier + `{` alone, without checking that the enclosing context was
// actually a class, and returned a property with neither key nor
// value, violating the assertion in the caller.
//
// Run the parse in a subprocess so a reintroduction (debug-build abort)
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
      timeout: 10_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Before the fix, the debug build aborted inside the
    // parser. After the fix the parser emits the
    // normal user-facing syntax error.
    expect(stderr).toContain('Expected "}" but found "{"');
    expect(proc.signalCode).toBeNull();
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  },
);
