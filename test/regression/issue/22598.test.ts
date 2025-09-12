import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("issue #22598 - temporal-polyfill/global sideEffects should be respected on Windows", async () => {
  using dir = tempDir("issue-22598", {
    "index.ts": `
      import "temporal-polyfill/global";
      console.log(typeof Temporal);
    `,
    "package.json": JSON.stringify({
      dependencies: {
        "temporal-polyfill": "0.3.0",
      },
    }),
  });

  // Install dependencies
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [installStdout, installStderr, installExitCode] = await Promise.all([
    installProc.stdout.text(),
    installProc.stderr.text(),
    installProc.exited,
  ]);

  expect(installExitCode).toBe(0);

  // Bundle the code
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "index.ts", "--outfile=bundled.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildExitCode).toBe(0);

  // Run the bundled output
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "bundled.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [runStdout, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  expect(runExitCode).toBe(0);
  expect(runStdout.trim()).toBe("object");

  // Verify the temporal-polyfill/global module is included in the bundle
  const bundledContent = await Bun.file(join(String(dir), "bundled.js")).text();
  expect(bundledContent).toContain("globalThis");
  expect(bundledContent).toContain("Temporal");
  expect(bundledContent).toContain("// node_modules/temporal-polyfill/global.esm.js");
});

test("sideEffects array with exact paths works cross-platform", async () => {
  using dir = tempDir("sideeffects-exact", {
    "index.ts": `
      import "./my-lib/side-effect.js";
      console.log(globalThis.MY_GLOBAL);
    `,
    "my-lib/package.json": JSON.stringify({
      name: "my-lib",
      sideEffects: ["./side-effect.js"],
    }),
    "my-lib/side-effect.js": `
      globalThis.MY_GLOBAL = "side-effect-loaded";
    `,
    "my-lib/no-effect.js": `
      export const unused = "should be tree-shaken";
    `,
  });

  // Bundle the code
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "index.ts", "--outfile=bundled.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildExitCode).toBe(0);

  // Run the bundled output
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "bundled.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [runStdout, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  expect(runExitCode).toBe(0);
  expect(runStdout.trim()).toBe("side-effect-loaded");

  // Verify the side-effect module is included
  const bundledContent = await Bun.file(join(String(dir), "bundled.js")).text();
  expect(bundledContent).toContain("MY_GLOBAL");
  expect(bundledContent).toContain("side-effect-loaded");
});

test("sideEffects false removes bare imports", async () => {
  using dir = tempDir("sideeffects-false", {
    "index.ts": `
      import "./my-lib/side-effect.js";
      console.log(globalThis.MY_GLOBAL || "undefined");
    `,
    "my-lib/package.json": JSON.stringify({
      name: "my-lib",
      sideEffects: false,
    }),
    "my-lib/side-effect.js": `
      globalThis.MY_GLOBAL = "should-not-load";
    `,
  });

  // Bundle the code
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "index.ts", "--outfile=bundled.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildExitCode).toBe(0);

  // Run the bundled output
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "bundled.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [runStdout, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  expect(runExitCode).toBe(0);
  expect(runStdout.trim()).toBe("undefined");

  // Verify the side-effect module is NOT included
  const bundledContent = await Bun.file(join(String(dir), "bundled.js")).text();
  expect(bundledContent).not.toContain("should-not-load");
});