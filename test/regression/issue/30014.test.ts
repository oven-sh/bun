import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/30014
// An async plugin onLoad returning a pending promise caused require() to
// throw "require() async module ... is unsupported" even when the resolved
// module itself has no top-level await. The fix pumps the event loop to
// await the plugin promise before declaring the module async.

test("require() with async plugin onLoad for .ts", async () => {
  using dir = tempDir("issue-30014-async-onload", {
    "preload.ts": `
      import { plugin } from "bun";

      plugin({
        name: "ts-pass-through",
        setup(build) {
          build.onLoad({ filter: /\\.ts$/ }, async ({ path }) => ({
            contents: await Bun.file(path).text(),
            loader: "ts",
          }));
        },
      });
    `,
    "entry.ts": `
      import { createRequire } from "module";

      const require = createRequire(import.meta.url);
      const mod = require("./repro.ts");
      console.log("typeof f:", typeof mod.f);
      console.log("greet:", mod.greet("world"));
    `,
    "repro.ts": `
      export async function f() {}
      export function greet(who: string) { return "Hello, " + who; }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.ts", "./entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("require() async module");
  expect(stdout).toContain("typeof f: function");
  expect(stdout).toContain("greet: Hello, world");
  expect(exitCode).toBe(0);
});

test("require() with async plugin that rejects surfaces the rejection", async () => {
  // The plugin only targets `.target.ts`, not `.ts`, so it doesn't reject
  // the entry file itself.
  using dir = tempDir("issue-30014-async-onload-reject", {
    "preload.ts": `
      import { plugin } from "bun";

      plugin({
        name: "async-reject-plugin",
        setup(build) {
          build.onLoad({ filter: /\\.target\\.ts$/ }, async ({ path }) => {
            await 1;
            throw new Error("intentional plugin failure");
          });
        },
      });
    `,
    "entry.ts": `
      import { createRequire } from "module";
      const require = createRequire(import.meta.url);
      try {
        require("./repro.target.ts");
        console.log("ERROR: should have thrown");
        process.exit(1);
      } catch (e: any) {
        console.log("caught:", e.message);
      }
    `,
    "repro.target.ts": `export const x = 1;`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.ts", "./entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("caught: intentional plugin failure");
  expect(stderr).not.toContain("unhandled");
  expect(exitCode).toBe(0);
});
