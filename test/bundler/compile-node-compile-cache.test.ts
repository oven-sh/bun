import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// `bun build --compile` copies the whole bun binary (~1GB under debug+ASAN),
// which blows the 5s default.
const TIMEOUT = 60_000;

// The compile cache settings of the outer shell must not decide the outcome.
const env = { ...bunEnv };
delete env.NODE_COMPILE_CACHE;
delete env.NODE_COMPILE_CACHE_PORTABLE;
delete env.NODE_DISABLE_COMPILE_CACHE;
delete env.NODE_DEBUG_NATIVE;
delete env.EXPLICIT_CACHE_DIR;

test(
  "compiled executables ignore NODE_COMPILE_CACHE and honor explicit activation",
  () => {
    // The app loads a module from outside the executable: the only code the
    // on-disk cache could hold for a standalone binary.
    using dir = tempDir("compile-node-compile-cache", {
      "app.js": `
        const assert = require("node:assert/strict");
        const { constants, enableCompileCache, flushCompileCache, getCompileCacheDir } = require("node:module");
        let directory;
        if (process.env.EXPLICIT_CACHE_DIR) {
          assert.equal(enableCompileCache(process.env.EXPLICIT_CACHE_DIR).status, constants.compileCacheStatus.ENABLED);
          directory = getCompileCacheDir();
          assert.equal(typeof directory, "string");
        }
        const ext = require(process.env.EXT_MOD);
        if (directory !== undefined) {
          assert.equal(getCompileCacheDir(), directory);
          assert.equal(enableCompileCache().status, constants.compileCacheStatus.ALREADY_ENABLED);
          flushCompileCache();
        }
        console.log("APP_OK", ext.value);
      `,
      "extmod.cjs": `module.exports = { value: 42 };`,
      "cache-standalone/.keep": "",
      "cache-bun/.keep": "",
    });
    const cwd = String(dir);

    const build = Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", "./app.js", "--outfile=app-compiled"],
      env,
      cwd,
    });
    expect(build.stderr.toString()).toBe("");
    expect(build.exitCode).toBe(0);

    const standalone = Bun.spawnSync({
      cmd: [join(cwd, "app-compiled")],
      env: {
        ...env,
        EXT_MOD: join(cwd, "extmod.cjs"),
        NODE_COMPILE_CACHE: join(cwd, "cache-standalone"),
      },
      cwd,
    });
    expect(standalone.stdout.toString()).toContain("APP_OK 42");
    expect(standalone.stderr.toString()).toBe("");
    expect(standalone.exitCode).toBe(0);
    expect(readdirSync(join(cwd, "cache-standalone"))).toEqual([".keep"]);

    const explicitEnv = {
      ...env,
      EXT_MOD: join(cwd, "extmod.cjs"),
      EXPLICIT_CACHE_DIR: join(cwd, "cache-explicit"),
      NODE_DEBUG_NATIVE: "COMPILE_CACHE",
    };
    const explicit = () => Bun.spawnSync({ cmd: [join(cwd, "app-compiled")], env: explicitEnv, cwd });
    const first = explicit();
    expect(first.stdout.toString()).toBe("APP_OK 42\n");
    expect(first.stderr.toString()).toMatch(/writing cache for CommonJS .*extmod\.cjs.*success/);
    expect(first.exitCode).toBe(0);
    expect([...new Bun.Glob("**/*").scanSync({ cwd: explicitEnv.EXPLICIT_CACHE_DIR, onlyFiles: true })]).toHaveLength(
      1,
    );

    const second = explicit();
    expect(second.stdout.toString()).toBe("APP_OK 42\n");
    expect(second.stderr.toString()).toMatch(/code cache for CommonJS .*extmod\.cjs was accepted/);
    expect(second.stderr.toString()).not.toContain("writing cache");
    expect(second.exitCode).toBe(0);

    const plain = Bun.spawnSync({
      cmd: [bunExe(), "app.js"],
      env: {
        ...env,
        EXT_MOD: join(cwd, "extmod.cjs"),
        NODE_COMPILE_CACHE: join(cwd, "cache-bun"),
      },
      cwd,
    });
    expect(plain.stdout.toString()).toContain("APP_OK 42");
    expect(plain.stderr.toString()).toBe("");
    expect(plain.exitCode).toBe(0);
    expect(readdirSync(join(cwd, "cache-bun")).length).toBeGreaterThan(1);
  },
  TIMEOUT,
);
