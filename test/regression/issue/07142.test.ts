// https://github.com/oven-sh/bun/issues/7142
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

describe.concurrent('exports "bun" condition target missing on disk', () => {
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

  test("falls through for the package.json imports map", async () => {
    using dir = tempDir("issue-7142-imports", {
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: { ".": "./index.mjs" },
        imports: {
          "#internal": {
            bun: "./bun.mjs",
            default: "./node.mjs",
          },
        },
      }),
      "node_modules/pkg/node.mjs": `export const picked = "node.mjs";\n`,
      "node_modules/pkg/index.mjs": `export { picked } from "#internal";\n`,
      "index.mjs": `import { picked } from "pkg";\nconsole.log(picked);\n`,
      "package.json": JSON.stringify({ name: "app", type: "module" }),
    });

    const { stdout, stderr, exitCode } = await run(dir, "index.mjs");
    expect(stderr).not.toContain("Cannot find");
    expect(stdout.trim()).toBe("node.mjs");
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

    const { stderr, exitCode } = await run(dir, "index.mjs");
    expect(stderr).toContain("pkg");
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

    const { stdout, stderr, exitCode } = await run(dir, "index.mjs");
    expect(stderr).toContain("pkg");
    expect(stdout.trim()).not.toBe("index.mjs");
    expect(exitCode).not.toBe(0);
  });
});
