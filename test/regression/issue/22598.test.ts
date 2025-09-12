import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("issue #22598 - sideEffects with exact paths should work on Windows", async () => {
  using dir = tempDir("issue-22598", {
    "index.ts": `
      import "my-module/side-effect";
      console.log(globalThis.TEST_GLOBAL);
    `,
    "node_modules/my-module/package.json": JSON.stringify({
      name: "my-module",
      exports: {
        "./side-effect": "./side-effect.js",
      },
      sideEffects: ["./side-effect.js"],
    }),
    "node_modules/my-module/side-effect.js": `
      globalThis.TEST_GLOBAL = "side-effect-loaded";
    `,
    "node_modules/my-module/other.js": `
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

  // Verify the side-effect module is included in the bundle
  const bundledContent = await Bun.file(`${dir}/bundled.js`).text();
  expect(bundledContent).toContain("TEST_GLOBAL");
  expect(bundledContent).toContain("side-effect-loaded");
});

test("sideEffects array with glob patterns works cross-platform", async () => {
  using dir = tempDir("sideeffects-glob", {
    "index.ts": `
      import "glob-module/effects/init";
      console.log(globalThis.GLOB_LOADED);
    `,
    "node_modules/glob-module/package.json": JSON.stringify({
      name: "glob-module",
      exports: {
        "./effects/init": "./effects/init.js",
      },
      sideEffects: ["./effects/*.js"],
    }),
    "node_modules/glob-module/effects/init.js": `
      globalThis.GLOB_LOADED = "glob-matched";
    `,
    "node_modules/glob-module/lib/util.js": `
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
  expect(runStdout.trim()).toBe("glob-matched");

  // Verify the side-effect module is included
  const bundledContent = await Bun.file(`${dir}/bundled.js`).text();
  expect(bundledContent).toContain("GLOB_LOADED");
  expect(bundledContent).toContain("glob-matched");
});

test("sideEffects false removes bare imports", async () => {
  using dir = tempDir("sideeffects-false", {
    "index.ts": `
      import "no-effects/init";
      console.log(globalThis.NO_EFFECT || "undefined");
    `,
    "node_modules/no-effects/package.json": JSON.stringify({
      name: "no-effects",
      exports: {
        "./init": "./init.js",
      },
      sideEffects: false,
    }),
    "node_modules/no-effects/init.js": `
      globalThis.NO_EFFECT = "should-not-load";
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
  const bundledContent = await Bun.file(`${dir}/bundled.js`).text();
  expect(bundledContent).not.toContain("should-not-load");
});
