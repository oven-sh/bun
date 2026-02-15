import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

// https://github.com/oven-sh/bun/issues/26901
// Bundler incorrectly passes isNodeMode=1 to __toESM for files that use ESM syntax
// but are NOT in a true Node.js ESM context (.mjs or "type": "module").
// This causes __esModule interop to be ignored, double-wrapping the default export.

test("bundler respects __esModule when importing CJS from non-module ESM file", async () => {
  using dir = tempDir("issue-26901", {
    "entry.js": `
      import { run } from "./esm-consumer/index.js";
      console.log(run());
    `,
    // ESM consumer in a regular .js file (no "type": "module" in package.json)
    // This should NOT get isNodeMode=1 in __toESM calls.
    "esm-consumer/package.json": JSON.stringify({ name: "esm-consumer", main: "index.js" }),
    "esm-consumer/index.js": `
      import MyLib from "./fake-cjs/index.js";
      export function run() {
        return MyLib.greet("World");
      }
    `,
    // CJS module with __esModule pattern (common in TypeScript-compiled packages)
    "esm-consumer/fake-cjs/package.json": JSON.stringify({ name: "fake-cjs", main: "index.js" }),
    "esm-consumer/fake-cjs/index.js": `
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        greet: function(name) { return "Hello, " + name; }
      };
    `,
  });

  // Bundle with target=node
  const buildResult = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.js")],
    outdir: path.join(String(dir), "out"),
    target: "node",
  });

  expect(buildResult.success).toBe(true);

  // Run the bundled output with node-like behavior (use bun for consistency)
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(String(dir), "out", "entry.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("Hello, World");
  expect(exitCode).toBe(0);
});

test("bundler still uses isNodeMode for .mjs files importing CJS", async () => {
  using dir = tempDir("issue-26901-mjs", {
    // .mjs file IS in a true Node.js ESM context, so isNodeMode should be set
    "entry.mjs": `
      import MyLib from "./fake-cjs/index.js";
      console.log(typeof MyLib);
    `,
    "fake-cjs/package.json": JSON.stringify({ name: "fake-cjs", main: "index.js" }),
    "fake-cjs/index.js": `
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        greet: function(name) { return "Hello, " + name; }
      };
    `,
  });

  const buildResult = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.mjs")],
    outdir: path.join(String(dir), "out"),
    target: "node",
  });

  expect(buildResult.success).toBe(true);

  // In .mjs context with isNodeMode=1, the entire module.exports becomes .default,
  // so MyLib should be the whole exports object (which has __esModule and default props)
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(String(dir), "out", "entry.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("object");
  expect(exitCode).toBe(0);
});

test("bundler respects __esModule for type:module .js files", async () => {
  using dir = tempDir("issue-26901-type-module", {
    // .js file with "type": "module" IS in a true Node.js ESM context
    "package.json": JSON.stringify({ type: "module" }),
    "entry.js": `
      import MyLib from "./fake-cjs/index.js";
      console.log(typeof MyLib);
    `,
    "fake-cjs/package.json": JSON.stringify({ name: "fake-cjs", main: "index.js" }),
    "fake-cjs/index.js": `
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        greet: function(name) { return "Hello, " + name; }
      };
    `,
  });

  const buildResult = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.js")],
    outdir: path.join(String(dir), "out"),
    target: "node",
  });

  expect(buildResult.success).toBe(true);

  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(String(dir), "out", "entry.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // In "type": "module" context with isNodeMode=1, the entire module.exports
  // becomes .default, so MyLib should be the whole exports object
  expect(stdout.trim()).toBe("object");
  expect(exitCode).toBe(0);
});
