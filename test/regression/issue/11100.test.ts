import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/11100
//
// A CommonJS module containing a `using` declaration used to be lowered into
// `import { __using, __callDispose } from "bun:wrap"; ...` which was then
// printed *inside* the CommonJS `(function(exports, require, module, ...) { ... })`
// wrapper — an ESM `import` inside a function body. JSC would reject that and
// Bun surfaced a confusing
// "TypeError: Expected CommonJS module to have a function wrapper" error.
//
// Now that Bun no longer lowers `using` / `await using` when targeting Bun,
// JSC evaluates the declaration directly and the module loads and throws the
// spec-correct error for a non-disposable value.

test("`using` in a CommonJS module does not emit an ESM import inside the CJS wrapper", async () => {
  using dir = tempDir("issue-11100", {
    "entry.cjs": `const path = require("node:path");
using server = {};
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).not.toContain("Expected CommonJS module to have a function wrapper");
  expect(stderr).not.toContain("bun:wrap");
  // `{}` has no [Symbol.dispose], so JSC throws the spec-mandated TypeError
  // when entering the `using` declaration.
  expect(stderr).toContain("TypeError");
  expect(stderr.toLowerCase()).toContain("dispose");
  expect(exitCode).toBe(1);
});

test("`using` in a CommonJS module disposes correctly", async () => {
  using dir = tempDir("issue-11100-ok", {
    "entry.cjs": `const path = require("node:path");
using server = { [Symbol.dispose]() { console.log("disposed"); } };
console.log("loaded", typeof path.join);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Expected CommonJS module to have a function wrapper");
  expect(stdout).toBe("loaded function\ndisposed\n");
  expect(exitCode).toBe(0);
});
