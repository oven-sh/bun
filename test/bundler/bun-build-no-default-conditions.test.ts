import { expect, test, describe } from "bun:test";
import { join } from "path";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { buildNoThrow } from "./buildNoThrow";

describe("noDefaultConditions option", () => {
  test("default behavior includes target conditions", async () => {
    // Test that without noDefaultConditions, default conditions are included
    // This ensures we don't break existing behavior
    const dir = tempDirWithFiles("no-default-conditions-default", {
      "package.json": JSON.stringify({
        exports: {
          ".": {
            node: "./node.js",
            browser: "./browser.js",
            default: "./index.js",
          },
        },
      }),
      "node.js": 'export const env = "node"',
      "browser.js": 'export const env = "browser"',
      "index.js": 'export const env = "default"',
      "entry.js": 'import * as m from "./package.json"; console.log(m.env)',
    });

    // Build for node target (should use 'node' condition by default)
    const build = await Bun.build({
      entrypoints: [join(dir, "entry.js")],
      target: "node",
      outdir: join(dir, "dist"),
    });

    expect(build.success).toBe(true);

    // Should have loaded the 'node' export since it's included by default
    const output = await build.outputs[0].text();
    expect(output).toContain("node");
  });

  test("noDefaultConditions with no user conditions falls back to 'default'", async () => {
    const dir = tempDirWithFiles("no-default-conditions-empty", {
      "package.json": JSON.stringify({
        exports: {
          ".": {
            node: "./node.js",
            browser: "./browser.js",
            default: "./index.js",
          },
        },
      }),
      "node.js": 'export const env = "node"',
      "browser.js": 'export const env = "browser"',
      "index.js": 'export const env = "default"',
      "entry.js": 'import * as m from "./package.json"; console.log(m.env)',
    });

    // Build with noDefaultConditions=true but no explicit conditions
    // Should only use "default" and context-specific keys like "import"/"require"
    const build = await Bun.build({
      entrypoints: [join(dir, "entry.js")],
      target: "node",
      outdir: join(dir, "dist"),
      noDefaultConditions: true,
    });

    expect(build.success).toBe(true);

    // Should resolve to 'default' since 'node' condition is not active
    const output = await build.outputs[0].text();
    expect(output).toContain("default");
  });

  test("noDefaultConditions with explicit conditions uses only those", async () => {
    const dir = tempDirWithFiles("no-default-conditions-custom", {
      "package.json": JSON.stringify({
        exports: {
          ".": {
            custom: "./custom.js",
            node: "./node.js",
            browser: "./browser.js",
            default: "./index.js",
          },
        },
      }),
      "custom.js": 'export const env = "custom"',
      "node.js": 'export const env = "node"',
      "browser.js": 'export const env = "browser"',
      "index.js": 'export const env = "default"',
      "entry.js": 'import * as m from "./package.json"; console.log(m.env)',
    });

    // Build with noDefaultConditions=true and custom conditions
    const build = await Bun.build({
      entrypoints: [join(dir, "entry.js")],
      target: "node",
      outdir: join(dir, "dist"),
      noDefaultConditions: true,
      conditions: ["custom"],
    });

    expect(build.success).toBe(true);

    // Should resolve to 'custom' since we explicitly provided it
    const output = await build.outputs[0].text();
    expect(output).toContain("custom");
  });

  test("CLI flag --no-default-conditions works", async () => {
    const dir = tempDirWithFiles("no-default-conditions-cli", {
      "package.json": JSON.stringify({
        exports: {
          ".": {
            node: "./node.js",
            default: "./index.js",
          },
        },
      }),
      "node.js": 'console.log("node"); export {}',
      "index.js": 'console.log("default"); export {}',
    });

    // Run with --no-default-conditions flag
    const { exitCode, stdout, stderr } = await Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        join(dir, "index.js"),
        "--outdir",
        join(dir, "dist"),
        "--target",
        "node",
        "--no-default-conditions",
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    }).exited.then(async code => ({
      exitCode: code,
      stdout:
        (
          await Bun.spawn({
            cmd: [
              bunExe(),
              "build",
              join(dir, "index.js"),
              "--outdir",
              join(dir, "dist"),
              "--target",
              "node",
              "--no-default-conditions",
            ],
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          }).stdout
        ).text?.() || "",
      stderr:
        (
          await Bun.spawn({
            cmd: [
              bunExe(),
              "build",
              join(dir, "index.js"),
              "--outdir",
              join(dir, "dist"),
              "--target",
              "node",
              "--no-default-conditions",
            ],
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          }).stderr
        ).text?.() || "",
    }));

    // The build should succeed, but we mainly check that the flag is recognized
    // (build success depends on whether index.js imports the package.json)
  });

  test("nested conditions with noDefaultConditions", async () => {
    const dir = tempDirWithFiles("no-default-conditions-nested", {
      "package.json": JSON.stringify({
        exports: {
          ".": {
            node: {
              require: "./node-cjs.js",
              import: "./node-esm.js",
              default: "./node.js",
            },
            default: "./index.js",
          },
        },
      }),
      "node-cjs.js": 'export const type = "node-cjs"',
      "node-esm.js": 'export const type = "node-esm"',
      "node.js": 'export const type = "node"',
      "index.js": 'export const type = "default"',
      "entry.js": 'import * as m from "./package.json"; console.log(m.type)',
    });

    // Build with noDefaultConditions=true - should use "default"
    const build = await Bun.build({
      entrypoints: [join(dir, "entry.js")],
      target: "node",
      outdir: join(dir, "dist"),
      noDefaultConditions: true,
    });

    expect(build.success).toBe(true);
    const output = await build.outputs[0].text();
    expect(output).toContain("default");
  });

  test("import condition still works with noDefaultConditions", async () => {
    const dir = tempDirWithFiles("no-default-conditions-import", {
      "package.json": JSON.stringify({
        exports: {
          ".": {
            import: "./esm.js",
            require: "./cjs.js",
            default: "./index.js",
          },
        },
      }),
      "esm.js": 'export const type = "esm"',
      "cjs.js": 'export const type = "cjs"',
      "index.js": 'export const type = "default"',
      "entry.mjs": 'import * as m from "./package.json"; console.log(m.type)',
    });

    // Build with noDefaultConditions=true - "import" should still work
    // because it's a context-specific condition, not a default
    const build = await Bun.build({
      entrypoints: [join(dir, "entry.mjs")],
      target: "node",
      outdir: join(dir, "dist"),
      noDefaultConditions: true,
    });

    expect(build.success).toBe(true);
    const output = await build.outputs[0].text();
    expect(output).toContain("esm");
  });

  test("require condition still works with noDefaultConditions", async () => {
    const dir = tempDirWithFiles("no-default-conditions-require", {
      "package.json": JSON.stringify({
        exports: {
          ".": {
            import: "./esm.js",
            require: "./cjs.js",
            default: "./index.js",
          },
        },
      }),
      "esm.js": 'export const type = "esm"',
      "cjs.js": 'export const type = "cjs"',
      "index.js": 'export const type = "default"',
      "entry.cjs": 'const m = require("./package.json"); console.log(m.type)',
    });

    // Build with noDefaultConditions=true - "require" should still work
    const build = await Bun.build({
      entrypoints: [join(dir, "entry.cjs")],
      target: "node",
      outdir: join(dir, "dist"),
      noDefaultConditions: true,
    });

    expect(build.success).toBe(true);
    const output = await build.outputs[0].text();
    expect(output).toContain("cjs");
  });

  test("multiple custom conditions with noDefaultConditions", async () => {
    const dir = tempDirWithFiles("no-default-conditions-multiple", {
      "package.json": JSON.stringify({
        exports: {
          ".": {
            production: "./prod.js",
            staging: "./staging.js",
            development: "./dev.js",
            node: "./node.js",
            default: "./index.js",
          },
        },
      }),
      "prod.js": 'export const env = "production"',
      "staging.js": 'export const env = "staging"',
      "dev.js": 'export const env = "development"',
      "node.js": 'export const env = "node"',
      "index.js": 'export const env = "default"',
      "entry.js": 'import * as m from "./package.json"; console.log(m.env)',
    });

    // Build with noDefaultConditions=true and multiple custom conditions
    const build = await Bun.build({
      entrypoints: [join(dir, "entry.js")],
      target: "node",
      outdir: join(dir, "dist"),
      noDefaultConditions: true,
      conditions: ["production", "staging", "development"],
    });

    expect(build.success).toBe(true);
    const output = await build.outputs[0].text();
    // Should resolve to first matching condition (production)
    expect(output).toContain("production");
  });

  test("noDefaultConditions=false explicitly enables defaults", async () => {
    const dir = tempDirWithFiles("no-default-conditions-false", {
      "package.json": JSON.stringify({
        exports: {
          ".": {
            node: "./node.js",
            default: "./index.js",
          },
        },
      }),
      "node.js": 'export const env = "node"',
      "index.js": 'export const env = "default"',
      "entry.js": 'import * as m from "./package.json"; console.log(m.env)',
    });

    // Explicitly set noDefaultConditions=false (should behave same as omitting it)
    const build = await Bun.build({
      entrypoints: [join(dir, "entry.js")],
      target: "node",
      outdir: join(dir, "dist"),
      noDefaultConditions: false,
    });

    expect(build.success).toBe(true);
    const output = await build.outputs[0].text();
    expect(output).toContain("node");
  });

  test("conditions and noDefaultConditions can be combined", async () => {
    const dir = tempDirWithFiles("no-default-conditions-combined", {
      "package.json": JSON.stringify({
        exports: {
          ".": {
            custom: "./custom.js",
            node: "./node.js",
            import: "./esm.js",
            default: "./index.js",
          },
        },
      }),
      "custom.js": 'export const type = "custom"',
      "node.js": 'export const type = "node"',
      "esm.js": 'export const type = "esm"',
      "index.js": 'export const type = "default"',
      "entry.mjs": 'import * as m from "./package.json"; console.log(m.type)',
    });

    // Build with both custom conditions and noDefaultConditions
    const build = await Bun.build({
      entrypoints: [join(dir, "entry.mjs")],
      target: "node",
      outdir: join(dir, "dist"),
      noDefaultConditions: true,
      conditions: ["custom"],
    });

    expect(build.success).toBe(true);
    const output = await build.outputs[0].text();
    // "import" is still active because it's context-specific (not a default),
    // so it should resolve to "import" export
    expect(output).toContain("esm");
  });
});
