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
// Reproduces on Linux only via `bun:internal-for-testing`, which drives
// the real `SideEffects.buildAbsolutePattern` + `hasSideEffects` code
// with synthetic Windows-style strings (`C:\pkg\adapters\foo.js`). The
// end-to-end `bun build` test below doesn't fail on Linux because the
// resolver never produces Windows-style `path.text` there; Windows CI
// catches that half of the regression.

import { packageJsonInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const { sideEffectsHasSideEffects } = packageJsonInternals;

test("#30320 SideEffects matches glob against Windows-style path", () => {
  // Pre-fix: `r.fs.join("C:\\pkg\\", "adapters/**/*.js")` on any host
  // produces `/C:/pkg/adapters/**/*.js` (leading slash from
  // `normalizeStringNodeT` for absolute-Windows inputs on `.loose`). The
  // runtime path `C:\pkg\adapters\foo.js` normalizes to
  // `C:/pkg/adapters/foo.js` — no leading `/` — so glob never matched.
  expect(sideEffectsHasSideEffects("C:\\pkg\\", ["adapters/**/*.js"], "C:\\pkg\\adapters\\foo.js", true)).toBe(false);
  expect(sideEffectsHasSideEffects("C:\\pkg\\", ["adapters/**/*.js"], "C:\\pkg\\adapters\\foo.js", false)).toBe(true);
});

test("#30320 SideEffects matches glob with ./ prefix against Windows-style path", () => {
  expect(sideEffectsHasSideEffects("C:\\pkg\\", ["./adapters/**/*.js"], "C:\\pkg\\adapters\\foo.js", true)).toBe(false);
  expect(sideEffectsHasSideEffects("C:\\pkg\\", ["./adapters/**/*.js"], "C:\\pkg\\adapters\\foo.js", false)).toBe(true);
});

test("#30320 SideEffects matches exact pattern against Windows-style path", () => {
  // Same mismatch on the exact-match side: the stored key was the
  // leading-`/` form, the runtime lookup key had no leading `/`, so the
  // hash never collided. (This is the `todo: isWindows` the PR also
  // removes from PackageJsonSideEffectsArray{Keep,KeepModule*}.)
  expect(sideEffectsHasSideEffects("C:\\pkg\\", ["adapters/foo.js"], "C:\\pkg\\adapters\\foo.js", true)).toBe(false);
  expect(sideEffectsHasSideEffects("C:\\pkg\\", ["adapters/foo.js"], "C:\\pkg\\adapters\\foo.js", false)).toBe(true);
});

test("#30320 SideEffects mixed (exact + glob) both match against Windows-style paths", () => {
  // Pre-fix: both halves fail.
  expect(
    sideEffectsHasSideEffects(
      "C:\\pkg\\",
      ["adapters/specific.js", "adapters/glob/*.js"],
      "C:\\pkg\\adapters\\specific.js",
      true,
    ),
  ).toBe(false);
  expect(
    sideEffectsHasSideEffects(
      "C:\\pkg\\",
      ["adapters/specific.js", "adapters/glob/*.js"],
      "C:\\pkg\\adapters\\glob\\one.js",
      true,
    ),
  ).toBe(false);

  // Post-fix: both halves match.
  expect(
    sideEffectsHasSideEffects(
      "C:\\pkg\\",
      ["adapters/specific.js", "adapters/glob/*.js"],
      "C:\\pkg\\adapters\\specific.js",
      false,
    ),
  ).toBe(true);
  expect(
    sideEffectsHasSideEffects(
      "C:\\pkg\\",
      ["adapters/specific.js", "adapters/glob/*.js"],
      "C:\\pkg\\adapters\\glob\\one.js",
      false,
    ),
  ).toBe(true);

  // Non-matching path: false either way — regression guard against an
  // over-eager fix that treats everything as side-effectful.
  expect(
    sideEffectsHasSideEffects(
      "C:\\pkg\\",
      ["adapters/specific.js", "adapters/glob/*.js"],
      "C:\\pkg\\adapters\\other.js",
      false,
    ),
  ).toBe(false);
});

test("#30320 SideEffects behaviour on POSIX paths unchanged", () => {
  // The fix must not regress POSIX matching — it produces the same
  // absolute pattern on both code paths there.
  expect(sideEffectsHasSideEffects("/pkg/", ["adapters/**/*.js"], "/pkg/adapters/foo.js", true)).toBe(true);
  expect(sideEffectsHasSideEffects("/pkg/", ["adapters/**/*.js"], "/pkg/adapters/foo.js", false)).toBe(true);

  expect(sideEffectsHasSideEffects("/pkg/", ["adapters/foo.js"], "/pkg/adapters/foo.js", true)).toBe(true);
  expect(sideEffectsHasSideEffects("/pkg/", ["adapters/foo.js"], "/pkg/adapters/foo.js", false)).toBe(true);
});

// End-to-end guard — uses the real bundler. On Windows CI this is the
// direct reproduction from the issue. On Linux it just verifies the fix
// didn't regress the already-working POSIX case.
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

  expect(stderr).toBe("");
  expect(stdout).toContain("foo adapter registered");
  expect(stdout).toContain("bar adapter registered");
  expect(exitCode).toBe(0);
});
