// https://github.com/oven-sh/bun/issues/29533

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("function-body 'use strict' is preserved in CJS", () => {
  const m = require("./29533-fn.fixture.cjs");
  expect(m.isES5).toBe(true);
  expect(m.typeofThis).toBe("string");
  expect(m.mode).toBe("strict");
});

test("module-level 'use strict' still enforces strict mode in CJS", () => {
  // The CJS wrapper re-emits module-level "use strict".
  const m = require("./29533-module.fixture.cjs");
  expect(m.typeofThis).toBe("string");
});

// Subprocesses inherit the parent's bun — under `bun bd` (ASAN debug) that
// binary prints a JSC warning to stderr unconditionally. Assert stderr has
// no "error:" rather than toBe("") so the warning doesn't fail the test.
// (panics/ASSERTION FAILED already produce a non-zero exit code, which the
// expect(exitCode).toBe(0) at each test callsite catches.)
function expectNoStderrErrors(stderr: string) {
  expect(stderr).not.toMatch(/^error:/im);
}

test.concurrent("function-body 'use strict' preserved in .js with package type=commonjs", async () => {
  // Same body shape as the fixture, but a .js file in a directory whose
  // package.json declares "commonjs" — exercises the CJS classifier path for
  // the extension the original reproduction hit (bluebird's index.js).
  using dir = tempDir("issue-29533-js", {
    "package.json": JSON.stringify({ type: "commonjs" }),
    "entry.js": `
      var isES5 = (function () {
        "use strict";
        return this === undefined;
      })();
      var mode = (function () {
        "use strict";
        try {
          __issue29533_spawn_sentinel__ = 1;
          return "sloppy";
        } catch (e) {
          return "strict";
        }
      })();
      console.log(isES5 + " " + mode);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expectNoStderrErrors(stderr);
  expect(stdout.trim()).toBe("true strict");
  expect(exitCode).toBe(0);
});

test.concurrent("non-strict module-level directive doesn't suppress CJS 'use strict' re-emission", async () => {
  // Regression guard: the CJS wrapper in P.zig skips re-emitting "use strict"
  // when the module already starts with one. That check must look at the
  // directive VALUE, not just the tag — otherwise a module that starts with
  // e.g. "use client" (or any other custom directive) followed by "use
  // strict" would run sloppy.
  using dir = tempDir("issue-29533-use-client", {
    "entry.cjs": `
      "use client";
      "use strict";
      var isStrict = (function () {
        return this === undefined;
      }).call(undefined);
      module.exports.isStrict = isStrict;
      console.log(isStrict);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.cjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expectNoStderrErrors(stderr);
  expect(stdout.trim()).toBe("true");
  expect(exitCode).toBe(0);
});

test.concurrent("block-scope string literals are not treated as directives", async () => {
  // ES2015 §14.1.1 restricts the directive prologue to the leading
  // ExpressionStatements of a FunctionBody or Script/Module. Block-scope
  // string expressions (dead code) must remain ordinary expressions so
  // DCE can still drop them under minify_syntax. Bundle with --minify and
  // confirm the block-scope string is gone.
  using dir = tempDir("issue-29533-block-dir", {
    "entry.js": `
      function foo() {
        if (true) {
          "__block_scope_should_be_dropped__";
          console.log("hello");
        }
      }
      foo();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--minify", "--target=node", "entry.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expectNoStderrErrors(stderr);
  expect(stdout).not.toContain("__block_scope_should_be_dropped__");
  expect(stdout).toContain('"hello"');
  expect(exitCode).toBe(0);
});
