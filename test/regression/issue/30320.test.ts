// https://github.com/oven-sh/bun/issues/30320
//
// sideEffects glob patterns didn't match on Windows. The pattern was built
// via `r.fs.join(dir, name)` with `.loose`, which routes through
// `joinStringBufT` → `normalizeStringNodeT`. On non-Windows that writes all
// forward slashes and prepends a leading `/` for absolute inputs, yielding
// `/C:/proj/node_modules/my-lib/adapters/**/*.js`. Runtime paths, however,
// come from `r.fs.absBuf` with `.loose`, which on Windows routes through
// `_joinAbsStringBufWindows` and emits `C:\proj\node_modules\my-lib\adapters\foo.js`
// — no leading `/`. After `normalizePathForGlob` (`\` → `/`) the pattern still
// started with `/` but the path didn't, so they never matched and Bun treated
// every file as side-effect-free. Prebid.js (`"sideEffects": ["dist/src/modules/**/*.js"]`)
// silently lost every bid adapter on Windows. Fixed by building the pattern
// with `r.fs.abs` so it goes through the same joiner the runtime path uses.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("#30320 sideEffects glob matches files in node_modules packages", async () => {
  using dir = tempDir("sideeffects-glob-30320", {
    "node_modules/my-lib/package.json": JSON.stringify({
      name: "my-lib",
      version: "1.0.0",
      main: "index.js",
      sideEffects: ["adapters/**/*.js"],
    }),
    "node_modules/my-lib/index.js": `export const lib = "my-lib";\n`,
    "node_modules/my-lib/adapters/foo.js": `console.log("foo adapter registered");\n`,
    "node_modules/my-lib/adapters/bar.js": `console.log("bar adapter registered");\n`,
    "entry.js": `
      import "my-lib/adapters/foo.js";
      import "my-lib/adapters/bar.js";
      console.log("entry");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  // Before the fix on Windows, both adapter side-effect imports were
  // tree-shaken because the glob pattern never matched the runtime path.
  expect(stdout).toContain("foo adapter registered");
  expect(stdout).toContain("bar adapter registered");
});

test("#30320 sideEffects glob matches with ./ prefix in pattern", async () => {
  using dir = tempDir("sideeffects-glob-30320-dotprefix", {
    "node_modules/my-lib/package.json": JSON.stringify({
      name: "my-lib",
      version: "1.0.0",
      main: "index.js",
      sideEffects: ["./adapters/**/*.js"],
    }),
    "node_modules/my-lib/index.js": `export const lib = "my-lib";\n`,
    "node_modules/my-lib/adapters/foo.js": `console.log("foo adapter registered");\n`,
    "entry.js": `
      import "my-lib/adapters/foo.js";
      console.log("entry");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout).toContain("foo adapter registered");
});

test("#30320 sideEffects exact match (non-glob string) preserved", async () => {
  // Same codepath: the exact-match map key is also built via the absolute
  // path joiner. Before the fix, the pattern's hash differed from the
  // runtime `path.text` hash on Windows.
  using dir = tempDir("sideeffects-exact-30320", {
    "node_modules/my-lib/package.json": JSON.stringify({
      name: "my-lib",
      version: "1.0.0",
      main: "index.js",
      sideEffects: ["adapters/foo.js"],
    }),
    "node_modules/my-lib/index.js": `export const lib = "my-lib";\n`,
    "node_modules/my-lib/adapters/foo.js": `console.log("foo adapter registered");\n`,
    "node_modules/my-lib/adapters/bar.js": `console.log("bar adapter - should be tree shaken");\n`,
    "entry.js": `
      import "my-lib/adapters/foo.js";
      import "my-lib/adapters/bar.js";
      console.log("entry");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout).toContain("foo adapter registered");
  // bar.js is NOT in sideEffects — tree-shaken
  expect(stdout).not.toContain("bar adapter");
});

test("#30320 sideEffects mixed (exact + glob) both work", async () => {
  using dir = tempDir("sideeffects-mixed-30320", {
    "node_modules/my-lib/package.json": JSON.stringify({
      name: "my-lib",
      version: "1.0.0",
      main: "index.js",
      sideEffects: ["adapters/specific.js", "adapters/glob/*.js"],
    }),
    "node_modules/my-lib/index.js": `export const lib = "my-lib";\n`,
    "node_modules/my-lib/adapters/specific.js": `console.log("specific effect");\n`,
    "node_modules/my-lib/adapters/glob/one.js": `console.log("glob one effect");\n`,
    "node_modules/my-lib/adapters/glob/two.js": `console.log("glob two effect");\n`,
    "node_modules/my-lib/adapters/other.js": `console.log("other - should tree shake");\n`,
    "entry.js": `
      import "my-lib/adapters/specific.js";
      import "my-lib/adapters/glob/one.js";
      import "my-lib/adapters/glob/two.js";
      import "my-lib/adapters/other.js";
      console.log("entry");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout).toContain("specific effect");
  expect(stdout).toContain("glob one effect");
  expect(stdout).toContain("glob two effect");
  expect(stdout).not.toContain("other");
});
