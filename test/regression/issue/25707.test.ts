import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/25707
// Dynamic import() of non-existent node: modules inside CJS files should not
// fail at transpile/require time. They should be deferred to runtime so that
// try/catch can handle the error gracefully.

test("require() of CJS file containing dynamic import of non-existent node: module does not fail at load time", async () => {
  using dir = tempDir("issue-25707", {
    // Simulates turbopack-generated chunks: a CJS module with a factory function
    // containing import("node:sqlite") inside a try/catch that is never called
    // during require().
    "chunk.js": `
      module.exports = [
        function factory(exports) {
          async function detect(e) {
            if ("createSession" in e) {
              let c;
              try {
                ({DatabaseSync: c} = await import("node:sqlite"))
              } catch(a) {
                if (null !== a && "object" == typeof a && "code" in a && "ERR_UNKNOWN_BUILTIN_MODULE" !== a.code)
                  throw a;
              }
            }
          }
          exports.detect = detect;
        }
      ];
    `,
    "main.js": `
      // This require() should not fail even though chunk.js contains import("node:sqlite")
      const factories = require("./chunk.js");
      console.log("loaded " + factories.length + " factories");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("loaded 1 factories");
  expect(exitCode).toBe(0);
});

test("require() of CJS file with bare dynamic import of non-existent node: module does not fail at load time", async () => {
  // The dynamic import is NOT inside a try/catch, but it's still a dynamic import
  // that should only be resolved at runtime, not at transpile time
  using dir = tempDir("issue-25707-bare", {
    "lib.js": `
      module.exports = async function() {
        const { DatabaseSync } = await import("node:sqlite");
        return DatabaseSync;
      };
    `,
    "main.js": `
      const fn = require("./lib.js");
      console.log("loaded");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("loaded");
  expect(exitCode).toBe(0);
});

test("dynamic import of non-existent node: module in CJS rejects at runtime with correct error", async () => {
  using dir = tempDir("issue-25707-runtime", {
    "lib.js": `
      module.exports = async function() {
        try {
          const { DatabaseSync } = await import("node:sqlite");
          return "resolved";
        } catch (e) {
          return "caught: " + e.code;
        }
      };
    `,
    "main.js": `
      const fn = require("./lib.js");
      fn().then(result => console.log(result));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("caught: ERR_UNKNOWN_BUILTIN_MODULE");
  expect(exitCode).toBe(0);
});
