import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("issue #12548: TypeScript syntax should work with 'ts' loader in BunPlugin", async () => {
  using dir = tempDir("issue-12548", {
    "index.js": `
      import plugin from "./plugin.js";

      Bun.plugin(plugin);

      // This should work with 'ts' loader
      console.log(require('virtual-ts-module'));
    `,
    "plugin.js": `
      export default {
        setup(build) {
          build.module('virtual-ts-module', () => ({
            contents: "import { type TSchema } from '@sinclair/typebox'; export const test = 'works';",
            loader: 'ts',
          }));
        },
      };
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).toContain('test: "works"');
});

test("issue #12548: TypeScript type imports work with 'ts' loader", async () => {
  using dir = tempDir("issue-12548-type-imports", {
    "index.js": `
      Bun.plugin({
        setup(build) {
          build.module('test-module', () => ({
            contents: \`
              import { type TSchema } from '@sinclair/typebox';
              type MyType = { a: number };
              export type { MyType };
              export const value = 42;
            \`,
            loader: 'ts',
          }));
        },
      });

      const mod = require('test-module');
      console.log(JSON.stringify(mod));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).toContain('{"value":42}');
});
