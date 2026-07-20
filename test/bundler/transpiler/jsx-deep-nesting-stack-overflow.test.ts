import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for a stack overflow in the TSX parser, found by fuzzing.
//
// `parse_jsx_element` recurses directly for every nested child element
// (`<a><b><c>...`), but unlike the other recursive parse entry points it never
// consulted the parser's stack guard. A source like `() => <div>` repeated
// thousands of times nests that many `<div>` children (the `() =>` between each
// pair is parsed as JSX text), so the unbounded recursion ran off the end of
// the stack and the process died on the guard page with a bare SIGSEGV — no
// crash handler, no error message.
//
// With the guard in place the parser stops and reports "Maximum call stack size
// exceeded" instead of crashing. The transpile runs in a child process so a
// regression fails these assertions rather than taking down the test runner.
test("deeply nested arrow/JSX does not overflow the stack", async () => {
  // Each `() => <div>` adds one arrow frame and one JSX-element frame. This is
  // far deeper than the fuzzer's ~23k repetitions so the guard fires well
  // before the real stack end on both release and the larger debug frames.
  // (`Buffer.alloc` fill over `.repeat` — the latter is very slow in debug JSC.)
  const unit = "() => <div>";
  const source = Buffer.alloc(unit.length * 50_000, unit).toString();

  using dir = tempDir("jsx-deep-nesting-stack-overflow", {
    "input.tsx": source,
    "run.ts": `
      const src = require("node:fs").readFileSync("input.tsx", "latin1");
      try {
        new Bun.Transpiler({
          loader: "tsx",
          target: "bun",
          minifyWhitespace: true,
          deadCodeElimination: true,
        }).transformSync(src);
        console.log("NO ERROR");
      } catch (e) {
        console.error(String((e as Error).message));
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Must terminate on its own, not be killed by the stack-guard-page SIGSEGV.
  expect(proc.signalCode).toBeNull();
  // The parser bounds the recursion and throws a catchable SyntaxError.
  expect(stderr).toContain("Maximum call stack size exceeded");
  expect(stdout).not.toContain("NO ERROR");
  expect(exitCode).toBe(0);
});
