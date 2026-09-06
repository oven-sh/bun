import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";

// `bun build --compile` copies the whole bun binary (~1GB under debug+ASAN),
// which blows the 5s default.
const TIMEOUT = 60_000;

// The compile cache settings of the outer shell must not decide the outcome.
const env = { ...bunEnv };
delete env.NODE_COMPILE_CACHE;
delete env.NODE_COMPILE_CACHE_PORTABLE;
delete env.NODE_DISABLE_COMPILE_CACHE;
delete env.NODE_DEBUG_NATIVE;

test(
  "NODE_COMPILE_CACHE is ignored by compiled executables and honored by bun",
  () => {
    // The app loads a module from outside the executable: the only code the
    // on-disk cache could hold for a standalone binary.
    using dir = tempDir("compile-node-compile-cache", {
      "app.js": `
        const ext = require(process.env.EXT_MOD);
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
        // Debug ASAN builds embed an @executable_path rpath for asan-dyld-shim.dylib;
        // the standalone exe lives elsewhere, so point dyld back at the build dir.
        DYLD_FALLBACK_LIBRARY_PATH: dirname(bunExe()),
      },
      cwd,
    });
    expect(standalone.stdout.toString()).toContain("APP_OK 42");
    expect(standalone.stderr.toString()).toBe("");
    expect(standalone.exitCode).toBe(0);
    expect(readdirSync(join(cwd, "cache-standalone"))).toEqual([".keep"]);

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
