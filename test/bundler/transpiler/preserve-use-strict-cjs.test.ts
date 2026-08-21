import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
import path from "path";

test.concurrent(`"use strict'; preserves strict mode in CJS`, async () => {
  expect(await bunRun(path.join(import.meta.dir, "strict-mode-fixture.ts"))).toSpawn();
});

test.concurrent(`sloppy mode by default in CJS`, async () => {
  expect(await bunRun(path.join(import.meta.dir, "sloppy-mode-fixture.ts"))).toSpawn();
});

test.concurrent(`"use strict"; after another directive preserves strict mode in CJS`, async () => {
  expect(await bunRun(path.join(import.meta.dir, "strict-mode-after-directive-fixture.cjs"))).toSpawn("strict");
});

test.concurrent(`"use strict"; after another directive preserves strict mode with the inspector enabled`, async () => {
  // With the inspector enabled the runtime transpiler does not minify syntax,
  // so the "use client" directive stays in the output as the first statement.
  // The transpiler used to skip "use strict" in that case, and the module ran
  // in sloppy mode only while it was being debugged.
  const socket = `/tmp/bun-use-strict-inspect-${process.pid}-${Date.now()}.sock`;
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "strict-mode-after-directive-fixture.cjs")],
      env: { ...bunEnv, BUN_INSPECT: isWindows ? "127.0.0.1:0" : "ws+unix://" + socket },
      stdout: "pipe",
      // The inspector prints its listening address here.
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("this is not undefined");
    expect(stdout).toBe("strict\n");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(socket, { force: true });
  }
});

test.concurrent(`"use strict"; after another directive preserves strict mode under bun test --coverage`, async () => {
  // --coverage turns syntax minification off for the whole process, the same
  // way the inspector does, so a test suite used to see such modules in
  // sloppy mode only when coverage was enabled.
  using dir = tempDir("use-strict-coverage", {
    "lib.cjs": readFileSync(path.join(import.meta.dir, "strict-mode-after-directive-fixture.cjs"), "utf8"),
    "lib.test.ts": `
      import { expect, test } from "bun:test";
      test("lib is strict", () => {
        expect(require("./lib.cjs")).toEqual({ FORCE_COMMON_JS: true });
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "./lib.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The fixture throws before it exports anything when it runs in sloppy mode.
  expect(stderr).not.toContain("this is not undefined");
  expect(stderr).toContain("1 pass");
  // The test runner prints its banner to stdout too.
  expect(stdout).toEndWith("strict\n");
  expect(exitCode).toBe(0);
});
