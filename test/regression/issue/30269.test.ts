// https://github.com/oven-sh/bun/issues/30269
//
// The ESM bundler renamer used to interleave two operations per part:
//   1. register that part's top-level symbols in the root scope, and
//   2. walk that part's nested scopes to rename collisions with the root.
//
// Because nested-scope walking for part N happened before part M>N's
// top-level symbols had been registered, a local binding in part N could be
// renamed to a name (`r` → `r2`) that later became a top-level symbol in
// part M (here the `r2` function). The local `r2` then shadowed the
// top-level `r2`, and callers inside `typecheck` invoked an `Expression`
// instance instead of the function.
//
// Fix: split the single-pass interleaved loop into two passes — register
// all top-level symbols for the whole chunk first, then walk nested scopes.
// Matches esbuild's structure.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("#30269 bundler doesn't rename a nested local into another top-level symbol's name", async () => {
  using dir = tempDir("bun-issue-30269", {
    // Importing this forces Bun's ESM renamer to treat `r` as a conflicting
    // name at the chunk's root scope. Removing `conflict.r()` from main.js
    // hides the bug.
    "conflict.js": `
      export function r() {
        return "top-level r";
      }
    `,
    // `typecheck` has a nested \`let r\`. The renamer picks \`r2\` for it —
    // but \`r2\` is already a top-level function in the same file.
    "module.js": `
      class Expression {}

      export function run() {
        const result = typecheck({ left: new Expression(), op: {}, right: {} });
        if (result !== true) throw new Error("expected true");
        return result;
      }

      function typecheck(node) {
        let r, t, c;
        block: {
          let k = node.left;
          let I = node.op;
          let q = node.right;
          r = k;
          t = I;
          c = q;
          break block;
        }

        let d = r;
        let n = t;
        let s = c;
        return r2().bo4(d, n, s).a();
      }

      function r2() {
        return {
          bo4() {
            return {
              a() {
                return true;
              },
            };
          },
        };
      }
    `,
    "main.js": `
      import * as conflict from "./conflict.js";
      import { run } from "./module.js";

      conflict.r();
      console.log("ok:", run());
    `,
  });

  // Bundle, then run the bundled file. The renamer bug is triggered during
  // bundling; executing the bundle is what surfaces the TypeError.
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--outfile", "out.js", "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  {
    const [stdout, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    // `stdout` carries the "Bundled N modules" banner; assert on it before
    // the exit-code check so a build failure shows what bun actually printed.
    expect(stdout).toContain("out.js");
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }

  await using run = Bun.spawn({
    cmd: [bunExe(), "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  // On the buggy build this stderr contains:
  //   TypeError: r2 is not a function. (In 'r2()', 'r2' is an instance of Expression)
  // Asserting on stdout + exit code is enough; stderr can hold unrelated
  // debug-build warnings (e.g. MADV_DONTNEED) that we don't want to flake on.
  expect(stdout).toBe("ok: true\n");
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
