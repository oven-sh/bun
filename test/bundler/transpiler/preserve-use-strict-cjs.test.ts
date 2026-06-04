import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

test(`"use strict'; preserves strict mode in CJS`, async () => {
  expect([path.join(import.meta.dir, "strict-mode-fixture.ts")]).toRun();
});

test(`sloppy mode by default in CJS`, async () => {
  expect([path.join(import.meta.dir, "sloppy-mode-fixture.ts")]).toRun();
});

// https://github.com/oven-sh/bun/issues/31806
test(`function-level "use strict" is honored in CJS`, async () => {
  expect([path.join(import.meta.dir, "function-use-strict-cjs-fixture.cjs")]).toRun();
});

test(`function-level "use strict" survives require() of a CJS module`, async () => {
  expect([path.join(import.meta.dir, "function-use-strict-require-entry-fixture.cjs")]).toRun();
});

// Preserving the function-body directive also enables the ES 15.2.1 early error:
// a "use strict" directive in a function with a non-simple parameter list is a
// SyntaxError (matches Node). https://github.com/oven-sh/bun/issues/18333
const source = `function test(a = 5) { "use strict"; console.log(a); }\ntest(2);\n`;
for (const ext of ["cjs", "js", "mjs"]) {
  test(`"use strict" with a non-simple parameter list is a SyntaxError (.${ext})`, async () => {
    using dir = tempDir(`issue-18333-${ext}`, { [`index.${ext}`]: source });

    await using proc = Bun.spawn({
      cmd: [bunExe(), `index.${ext}`],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("use strict");
    expect(stderr).toContain("non-simple parameter list");
    expect(exitCode).not.toBe(0);
  });
}
