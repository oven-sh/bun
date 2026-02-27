import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/27488
// Tail calls in the REPL should work (requires strict mode for JSC TCO)
test("REPL supports tail call optimization", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "repl", "-e", "const foo = n => n <= 0 ? n : foo(n-1); console.log(foo(100000));"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("0");
  expect(exitCode).toBe(0);
});
