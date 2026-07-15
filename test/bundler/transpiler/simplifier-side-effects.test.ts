import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Runtime proof that side effects inside array/object literals under `!` and
// `typeof` are not discarded by the simplifier. The transpiler-output
// assertions for these shapes live in transpiler.test.js under
// "constant folding" and "property access inlining".

test("side effects inside ![...] / typeof [...] run at runtime", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let n = 0; const fx = () => { n++; return 1 }; ` +
        `const a = ![fx()]; const b = !{ x: fx() }; const c = typeof [fx()]; ` +
        `const d = !(fx(), true); const e = !typeof fx(); ` +
        `console.log(n, a, b, c, d, e);`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("5 false false object false false\n");
  expect(exitCode).toBe(0);
});
