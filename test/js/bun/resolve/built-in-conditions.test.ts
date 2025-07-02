import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("module-sync condition", () => {
  it("takes precedence over require/import conditions", async () => {
    const dir = tempDirWithFiles("module-sync-precedence-test", {
      "test-require.js": 'const pkg = require("test-pkg"); console.log(pkg.source);',
      "test-import.js": 'import { source } from "test-pkg"; console.log(source);',
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        exports: {
          ".": {
            "module-sync": "./module-sync.mjs",
            "import": "./import.mjs",
            "require": "./require.cjs",
            "default": "./fallback.js",
          },
        },
      }),
      "node_modules/test-pkg/module-sync.mjs": "export const source = 'module-sync';",
      "node_modules/test-pkg/require.cjs": "module.exports = { source: 'require' };",
      "node_modules/test-pkg/import.mjs": "export const source = 'import';",
      "node_modules/test-pkg/fallback.js": "export const source = 'fallback';",
    });

    const { exitCode: reqExit, stdout: reqOut } = Bun.spawnSync({
      cmd: [bunExe(), "./test-require.js"],
      env: bunEnv,
      cwd: dir,
    });
    expect(reqExit).toBe(0);
    expect(reqOut.toString("utf8").trim()).toBe("module-sync");

    const { exitCode: impExit, stdout: impOut } = Bun.spawnSync({
      cmd: [bunExe(), "./test-import.js"],
      env: bunEnv,
      cwd: dir,
    });
    expect(impExit).toBe(0);
    expect(impOut.toString("utf8").trim()).toBe("module-sync");
  });

  it("works with nested conditions", async () => {
    const dir = tempDirWithFiles("module-sync-nested-test", {
      "test-require.js": 'const pkg = require("test-pkg/sub"); console.log(pkg.source);',
      "test-import.js": 'import { source } from "test-pkg/sub"; console.log(source);',
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        exports: {
          "./sub": {
            "bun": {
              "module-sync": "./bun-module-sync.mjs",
              "require": "./bun-require.cjs",
              "import": "./bun-import.mjs",
            },
            "node": {
              "module-sync": "./node-module-sync.mjs",
              "require": "./node-require.cjs",
              "import": "./node-import.mjs",
            },
            "default": "./fallback.js",
          },
        },
      }),
      "node_modules/test-pkg/bun-module-sync.mjs": "export const source = 'bun-module-sync';",
      "node_modules/test-pkg/bun-require.cjs": "module.exports = { source: 'bun-require' };",
      "node_modules/test-pkg/bun-import.mjs": "export const source = 'bun-import';",
      "node_modules/test-pkg/node-module-sync.mjs": "export const source = 'node-module-sync';",
      "node_modules/test-pkg/node-require.cjs": "module.exports = { source: 'node-require' };",
      "node_modules/test-pkg/node-import.mjs": "export const source = 'node-import';",
      "node_modules/test-pkg/fallback.js": "export const source = 'fallback';",
    });

    const { exitCode: reqExit, stdout: reqOut } = Bun.spawnSync({
      cmd: [bunExe(), "./test-require.js"],
      env: bunEnv,
      cwd: dir,
    });
    expect(reqExit).toBe(0);
    expect(reqOut.toString("utf8").trim()).toBe("bun-module-sync");

    const { exitCode: impExit, stdout: impOut } = Bun.spawnSync({
      cmd: [bunExe(), "./test-import.js"],
      env: bunEnv,
      cwd: dir,
    });
    expect(impExit).toBe(0);
    expect(impOut.toString("utf8").trim()).toBe("bun-module-sync");
  });

  it("works in bundler", async () => {
    const dir = tempDirWithFiles("module-sync-bundler-test", {
      "entry.js": 'import pkg from "test-pkg"; console.log(pkg.source);',
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        main: "./fallback.js",
        exports: {
          ".": {
            "module-sync": "./module-sync.mjs",
            "require": "./require.cjs",
            "import": "./import.mjs",
            "default": "./fallback.js",
          },
        },
      }),
      "node_modules/test-pkg/module-sync.mjs": "export default { source: 'module-sync' };",
      "node_modules/test-pkg/require.cjs": "module.exports = { source: 'require' };",
      "node_modules/test-pkg/import.mjs": "export default { source: 'import' };",
      "node_modules/test-pkg/fallback.js": "module.exports = { source: 'fallback' };",
    });

    const { exitCode: bundleExit } = Bun.spawnSync({
      cmd: [bunExe(), "build", "./entry.js", "--outdir=./dist"],
      env: bunEnv,
      cwd: dir,
    });
    expect(bundleExit).toBe(0);

    const { exitCode: runExit, stdout: runOut } = Bun.spawnSync({
      cmd: [bunExe(), "./dist/entry.js"],
      env: bunEnv,
      cwd: dir,
    });
    expect(runExit).toBe(0);
    const output = runOut.toString("utf8").trim();
    expect(["module-sync", "import"]).toContain(output);
  });

  it("works with custom conditions", async () => {
    const testDir = tempDirWithFiles("module-sync-with-custom-test", {
      "test.js": 'const pkg = require("test-pkg"); console.log(pkg.source);',
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        exports: {
          ".": {
            "custom": "./custom.js",
            "module-sync": "./module-sync.mjs",
            "require": "./require.cjs",
            "import": "./import.mjs",
            "default": "./fallback.js",
          },
        },
      }),
      "node_modules/test-pkg/custom.js": "module.exports = { source: 'custom' };",
      "node_modules/test-pkg/module-sync.mjs": "export const source = 'module-sync';",
      "node_modules/test-pkg/require.cjs": "module.exports = { source: 'require' };",
      "node_modules/test-pkg/import.mjs": "export const source = 'import';",
      "node_modules/test-pkg/fallback.js": "module.exports = { source: 'fallback' };",
    });

    // With custom condition
    {
      const { exitCode, stdout } = Bun.spawnSync({
        cmd: [bunExe(), "--conditions=custom", "./test.js"],
        env: bunEnv,
        cwd: testDir,
      });
      expect(exitCode).toBe(0);
      expect(stdout.toString("utf8").trim()).toBe("custom");
    }

    // Without custom condition
    {
      const { exitCode, stdout } = Bun.spawnSync({
        cmd: [bunExe(), "./test.js"],
        env: bunEnv,
        cwd: testDir,
      });
      expect(exitCode).toBe(0);
      expect(stdout.toString("utf8").trim()).toBe("module-sync");
    }
  });
});

describe("require/import conditions", () => {
  it("require() uses require condition", async () => {
    const dir = tempDirWithFiles("normal-require-test", {
      "test-require.js": 'const pkg = require("test-pkg"); console.log(pkg.source);',
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        exports: {
          ".": {
            "require": "./require.cjs",
            "import": "./import.mjs",
            "default": "./fallback.js",
          },
        },
      }),
      "node_modules/test-pkg/require.cjs": "module.exports = { source: 'require' };",
      "node_modules/test-pkg/import.mjs": "export const source = 'import';",
      "node_modules/test-pkg/fallback.js": "export const source = 'fallback';",
    });

    const { exitCode, stdout } = Bun.spawnSync({
      cmd: [bunExe(), "./test-require.js"],
      env: bunEnv,
      cwd: dir,
    });
    expect(exitCode).toBe(0);
    expect(stdout.toString("utf8").trim()).toBe("require");
  });

  it("import() uses import condition", async () => {
    const dir = tempDirWithFiles("normal-import-test", {
      "test-import.js": 'import { source } from "test-pkg"; console.log(source);',
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        exports: {
          ".": {
            "require": "./require.cjs",
            "import": "./import.mjs",
            "default": "./fallback.js",
          },
        },
      }),
      "node_modules/test-pkg/require.cjs": "module.exports = { source: 'require' };",
      "node_modules/test-pkg/import.mjs": "export const source = 'import';",
      "node_modules/test-pkg/fallback.js": "export const source = 'fallback';",
    });

    const { exitCode, stdout } = Bun.spawnSync({
      cmd: [bunExe(), "./test-import.js"],
      env: bunEnv,
      cwd: dir,
    });
    expect(exitCode).toBe(0);
    expect(stdout.toString("utf8").trim()).toBe("import");
  });

  it("falls back to default", async () => {
    const dir = tempDirWithFiles("fallback-test", {
      "test-require.js": 'const pkg = require("test-pkg"); console.log(pkg.source);',
      "test-import.js": 'import { source } from "test-pkg"; console.log(source);',
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        exports: {
          ".": {
            "worker": "./worker.js",
            "default": "./fallback.js",
          },
        },
      }),
      "node_modules/test-pkg/worker.js": "export const source = 'worker';",
      "node_modules/test-pkg/fallback.js": "export const source = 'fallback';",
    });

    const { exitCode: reqExit, stdout: reqOut } = Bun.spawnSync({
      cmd: [bunExe(), "./test-require.js"],
      env: bunEnv,
      cwd: dir,
    });
    expect(reqExit).toBe(0);
    expect(reqOut.toString("utf8").trim()).toBe("fallback");

    const { exitCode: impExit, stdout: impOut } = Bun.spawnSync({
      cmd: [bunExe(), "./test-import.js"],
      env: bunEnv,
      cwd: dir,
    });
    expect(impExit).toBe(0);
    expect(impOut.toString("utf8").trim()).toBe("fallback");
  });

  it("bun condition takes precedence", async () => {
    const dir = tempDirWithFiles("bun-condition-test", {
      "test-require.js": 'const pkg = require("test-pkg"); console.log(pkg.source);',
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        exports: {
          ".": {
            "bun": "./bun.js",
            "node": "./node.js",
            "default": "./fallback.js",
          },
        },
      }),
      "node_modules/test-pkg/bun.js": "module.exports = { source: 'bun' };",
      "node_modules/test-pkg/node.js": "module.exports = { source: 'node' };",
      "node_modules/test-pkg/fallback.js": "module.exports = { source: 'fallback' };",
    });

    const { exitCode, stdout } = Bun.spawnSync({
      cmd: [bunExe(), "./test-require.js"],
      env: bunEnv,
      cwd: dir,
    });
    expect(exitCode).toBe(0);
    expect(stdout.toString("utf8").trim()).toBe("bun");
  });
});
