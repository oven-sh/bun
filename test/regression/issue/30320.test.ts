// https://github.com/oven-sh/bun/issues/30320
//
// sideEffects glob patterns didn't match on Windows. The pattern was built
// via `r.fs.join(dir, name)` with `.loose`, which routes through
// `joinStringBufT` → `normalizeStringNodeT`. That prepends a leading `/`
// for absolute inputs, yielding `/C:/proj/node_modules/my-lib/adapters/**/*.js`.
// Runtime paths, however, come from `r.fs.absBuf` with `.loose`, which on
// Windows routes through `_joinAbsStringBufWindows` and emits
// `C:\proj\node_modules\my-lib\adapters\foo.js` — no leading `/`. After
// `normalizePathForGlob` (`\` → `/`) the pattern still started with `/`
// but the path didn't, so they never matched and Bun treated every file as
// side-effect-free. Prebid.js
// (`"sideEffects": ["dist/src/modules/**/*.js"]`) silently lost every bid
// adapter on Windows. Fixed by building the pattern with `r.fs.abs` so it
// goes through the same joiner the runtime path uses.
//
// The regression only reproduces on Windows; this end-to-end test guards
// the real resolver → bundler path. On Linux it verifies the fix didn't
// regress the already-working POSIX case.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("#30320 bundler preserves sideEffects glob imports", async () => {
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Don't pin stderr to empty — ASAN shards can emit benign warnings on a
  // clean run. Only consult stderr when the build actually failed.
  expect(stdout).toContain("foo adapter registered");
  expect(stdout).toContain("bar adapter registered");
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("#30320 bundler preserves sideEffects exact-match imports", async () => {
  // Exact-match side-effects entries suffered from the same leading-`/`
  // mismatch: the stored key was `/C:/pkg/adapters/foo.js`, the runtime
  // lookup key was `C:/pkg/adapters/foo.js`, hashes never collided.
  using dir = tempDir("sideeffects-exact-30320", {
    "node_modules/my-lib/package.json": JSON.stringify({
      name: "my-lib",
      version: "1.0.0",
      main: "index.js",
      sideEffects: ["adapters/foo.js"],
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("foo adapter registered");
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
