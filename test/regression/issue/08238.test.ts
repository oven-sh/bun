import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/8238
//
// A package without an "exports" map but with "main" (CJS) + "module" (.mjs)
// depends on a package that does have an "exports" map routing import/require
// to different files. At runtime Bun resolved the first package via "main",
// whose require("dep") loaded the CJS copy, while the user's `import "dep"`
// loaded the ESM copy: two instances, module-level state never shared.
//
// Real-world case: zod-i18n-map (main/module only) + zod & i18next (both have
// exports with import/require split). z.setErrorMap() hit the ESM zod while
// zod-i18n-map held the CJS zod's defaultErrorMap.
test("runtime prefers .mjs 'module' over 'main' for ESM import to avoid dual-package hazard", async () => {
  using dir = tempDir("issue-08238", {
    // Dependency with module-level state and an exports map that splits
    // import/require (mirrors zod / i18next).
    "node_modules/stateful/package.json": JSON.stringify({
      name: "stateful",
      main: "./index.cjs",
      exports: {
        ".": { import: "./index.mjs", require: "./index.cjs" },
      },
    }),
    "node_modules/stateful/index.mjs": `
      let value = "unset-esm";
      export function set(v) { value = v; }
      export function get() { return value; }
    `,
    "node_modules/stateful/index.cjs": `
      let value = "unset-cjs";
      exports.set = v => { value = v; };
      exports.get = () => value;
    `,

    // Consumer with main + module but no exports (mirrors zod-i18n-map).
    // The .mjs build imports "stateful" (so it should see the ESM copy).
    "node_modules/consumer/package.json": JSON.stringify({
      name: "consumer",
      main: "./dist/index.js",
      module: "./dist/index.mjs",
    }),
    "node_modules/consumer/dist/index.js": `
      const stateful = require("stateful");
      exports.read = () => stateful.get();
    `,
    "node_modules/consumer/dist/index.mjs": `
      import { get } from "stateful";
      export const read = () => get();
    `,

    "entry.ts": `
      import { set } from "stateful";
      import { read } from "consumer";
      set("hello");
      console.log(read());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // Before the fix this printed "unset-cjs": consumer resolved via "main"
  // and required the CJS copy of stateful, which never saw set("hello").
  expect(stdout.trim()).toBe("hello");
  expect(exitCode).toBe(0);
});

test("runtime still prefers 'main' when 'module' is .js (not explicit ESM)", async () => {
  using dir = tempDir("issue-08238-js-module", {
    "node_modules/pkg/package.json": JSON.stringify({
      name: "pkg",
      main: "./main.cjs",
      module: "./module.js",
    }),
    "node_modules/pkg/main.cjs": `module.exports.which = "main";`,
    "node_modules/pkg/module.js": `export const which = "module";`,
    "entry.ts": `
      import { which } from "pkg";
      console.log(which);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // #3434: a .js "module" target is typically a browser bundler build; runtime
  // must keep using "main" here.
  expect(stdout.trim()).toBe("main");
  expect(exitCode).toBe(0);
});

test("require() still prefers 'main' even when 'module' is .mjs", async () => {
  using dir = tempDir("issue-08238-require", {
    "node_modules/pkg/package.json": JSON.stringify({
      name: "pkg",
      main: "./main.cjs",
      module: "./module.mjs",
    }),
    "node_modules/pkg/main.cjs": `module.exports.which = "main";`,
    "node_modules/pkg/module.mjs": `export const which = "module";`,
    "entry.cjs": `
      const { which } = require("pkg");
      console.log(which);
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

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("main");
  expect(exitCode).toBe(0);
});
