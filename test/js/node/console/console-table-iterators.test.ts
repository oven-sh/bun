import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A broken Console builtin aborts the whole process the moment `node:console`
// is loaded, so this has to be a spawned fixture: an in-process test in
// console.test.ts would take the test runner down with it.
test("console.Console#table renders Map and Set iterators", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Console } = require("node:console");
       const c = new Console({ stdout: process.stdout, stderr: process.stderr, colorMode: false });
       c.table(new Map([["a", 1], ["b", 2]]).entries());
       c.table(new Set([7, 8]).values());`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect(stdout).toMatchInlineSnapshot(`
    "┌───────────────────┬────────────┐
    │ (iteration index) │   Values   │
    ├───────────────────┼────────────┤
    │         0         │ [ 'a', 1 ] │
    │         1         │ [ 'b', 2 ] │
    └───────────────────┴────────────┘
    ┌───────────────────┬────────┐
    │ (iteration index) │ Values │
    ├───────────────────┼────────┤
    │         0         │   7    │
    │         1         │   8    │
    └───────────────────┴────────┘
    "
  `);
  expect(exitCode).toBe(0);
});
