// https://github.com/oven-sh/bun/issues/7142
//
// Nitro/Nuxt produce a `.output/server/node_modules` that only contains the
// files the "node" exports condition reaches. Packages like `ofetch` and
// `node-fetch-native` also declare a `"bun"` condition pointing at a file the
// bundler never copied, so Bun matched `"bun"`, found no file on disk, and
// failed the whole resolution with "Cannot find package". When the `"bun"`
// target is missing we now retry exports resolution without that condition so
// the `"node"` / `"default"` target (which Node.js would pick) is used instead.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(dir: string, entry: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe('exports "bun" condition target missing on disk', () => {
  test("falls through to the node condition (import)", async () => {
    using dir = tempDir("issue-7142-import", {
      "node_modules/ofetch/package.json": JSON.stringify({
        name: "ofetch",
        type: "module",
        exports: {
          ".": {
            bun: "./dist/index.mjs",
            node: {
              import: { default: "./dist/node.mjs" },
              require: { default: "./dist/node.cjs" },
            },
            default: "./dist/index.mjs",
          },
        },
      }),
      // only the node target shipped
      "node_modules/ofetch/dist/node.mjs": `export const picked = "node.mjs";\n`,
      "node_modules/ipx/package.json": JSON.stringify({
        name: "ipx",
        type: "module",
        exports: { ".": "./dist/index.mjs" },
      }),
      "node_modules/ipx/dist/index.mjs": `export { picked } from "ofetch";\n`,
      "index.mjs": `import { picked } from "ipx";\nconsole.log(picked);\n`,
      "package.json": JSON.stringify({ name: "app", type: "module" }),
    });

    const { stdout, stderr, exitCode } = await run(dir, "index.mjs");
    expect(stderr).not.toContain("Cannot find package");
    expect(stdout.trim()).toBe("node.mjs");
    expect(exitCode).toBe(0);
  });

  test("falls through to the node condition (require)", async () => {
    using dir = tempDir("issue-7142-require", {
      "node_modules/ofetch/package.json": JSON.stringify({
        name: "ofetch",
        exports: {
          ".": {
            bun: "./dist/bun.cjs",
            node: "./dist/node.cjs",
            default: "./dist/index.cjs",
          },
        },
      }),
      "node_modules/ofetch/dist/node.cjs": `module.exports = { picked: "node.cjs" };\n`,
      "index.cjs": `const { picked } = require("ofetch");\nconsole.log(picked);\n`,
      "package.json": JSON.stringify({ name: "app" }),
    });

    const { stdout, stderr, exitCode } = await run(dir, "index.cjs");
    expect(stderr).not.toContain("Cannot find package");
    expect(stdout.trim()).toBe("node.cjs");
    expect(exitCode).toBe(0);
  });

  test("falls through for wildcard subpath patterns", async () => {
    using dir = tempDir("issue-7142-wildcard", {
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: {
          "./*": {
            bun: "./bun/*.mjs",
            default: "./dist/*.mjs",
          },
        },
      }),
      "node_modules/pkg/dist/thing.mjs": `export const picked = "dist/thing.mjs";\n`,
      "index.mjs": `import { picked } from "pkg/thing";\nconsole.log(picked);\n`,
      "package.json": JSON.stringify({ name: "app", type: "module" }),
    });

    const { stdout, stderr, exitCode } = await run(dir, "index.mjs");
    expect(stderr).not.toContain("Cannot find package");
    expect(stdout.trim()).toBe("dist/thing.mjs");
    expect(exitCode).toBe(0);
  });

  test("still prefers the bun condition when its target exists", async () => {
    using dir = tempDir("issue-7142-prefers-bun", {
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: {
          ".": {
            bun: "./dist/bun.mjs",
            node: "./dist/node.mjs",
            default: "./dist/node.mjs",
          },
        },
      }),
      "node_modules/pkg/dist/bun.mjs": `export const picked = "bun.mjs";\n`,
      "node_modules/pkg/dist/node.mjs": `export const picked = "node.mjs";\n`,
      "index.mjs": `import { picked } from "pkg";\nconsole.log(picked);\n`,
      "package.json": JSON.stringify({ name: "app", type: "module" }),
    });

    const { stdout, exitCode } = await run(dir, "index.mjs");
    expect(stdout.trim()).toBe("bun.mjs");
    expect(exitCode).toBe(0);
  });

  test("still fails when the fallback target is also missing", async () => {
    using dir = tempDir("issue-7142-all-missing", {
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: {
          ".": {
            bun: "./dist/bun.mjs",
            default: "./dist/index.mjs",
          },
        },
      }),
      "node_modules/pkg/dist/placeholder.mjs": "",
      "index.mjs": `import "pkg";\n`,
      "package.json": JSON.stringify({ name: "app", type: "module" }),
    });

    const { exitCode } = await run(dir, "index.mjs");
    expect(exitCode).not.toBe(0);
  });

  test("bun: null is still respected as a hard block", async () => {
    using dir = tempDir("issue-7142-null", {
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: {
          ".": {
            bun: null,
            default: "./dist/index.mjs",
          },
        },
      }),
      "node_modules/pkg/dist/index.mjs": `export const picked = "index.mjs";\n`,
      "index.mjs": `import { picked } from "pkg";\nconsole.log(picked);\n`,
      "package.json": JSON.stringify({ name: "app", type: "module" }),
    });

    const { stdout, exitCode } = await run(dir, "index.mjs");
    expect(stdout.trim()).not.toBe("index.mjs");
    expect(exitCode).not.toBe(0);
  });
});
