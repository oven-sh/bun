// https://github.com/oven-sh/bun/issues/31002
//
// `if (0) var []` (a destructuring `var` with zero bindings inside a
// statically-dead branch) panicked the printer with
// `panic: internal error: entered unreachable code` at
// `src/js_printer/lib.rs:2308`. The printer asserts that a `var` decl list
// is never empty ("var;" is invalid syntax). The dead-code elimination
// pass in `scan_side_effects.rs::should_keep_stmt_in_dead_control_flow`
// hoists identifiers out of destructuring patterns to preserve `var`
// hoisting semantics; when the pattern binds no identifiers (`var []`,
// `var {}`) the list collapsed to empty but the statement was still
// kept, tripping the printer invariant in the next pass.
//
// The fix: when the hoisted identifiers vector is empty, drop the whole
// statement. There is nothing to hoist and no valid `var` output exists.
//
// Run in a subprocess so a reintroduction (panic in the child) doesn't
// tear down the in-process test runner.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent.each([
  // Bare `var []` / `var {}` as the only statement in a dead `if` body.
  // These were the exact forms in the bug report; without the fix, each
  // one crashed the printer.
  "if(0)var[]",
  "if(0)var{}",
  // Same empty destructuring inside a function body — the DCE path runs
  // per-scope and must not crash regardless of enclosing scope.
  "function f(){if(0)var[]}",
])("`%s` does not crash the printer (dead-branch destructuring var with no bindings)", async source => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Before the fix: stderr carried `panic: internal error: entered
  // unreachable code` and the process exited with a crash signal.
  // After the fix: the dead branch is dropped and the program exits 0
  // with no output.
  expect(stdout).toBe("");
  expect(stderr).toBe("");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

test.concurrent("dead-branch destructuring with real identifiers still hoists them as `undefined`", async () => {
  // Regression guard: the fix must not drop destructuring `var`s that do
  // introduce bindings — those still need to be hoisted so that reads
  // after the dead `if` see `undefined` (not ReferenceError).
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "if(0) var [a, b] = []; console.log(typeof a, typeof b);"],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("undefined undefined\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
