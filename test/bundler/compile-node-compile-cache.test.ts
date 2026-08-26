import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Standalone executables ship their modules embedded, so NODE_COMPILE_CACHE in
// the surrounding environment could only ever cache externally loaded JS —
// while pulling the whole runtime encode/decode machinery into an app that
// never asked for it. Compiled binaries ignore the variable; plain `bun` still
// honors it.
test("NODE_COMPILE_CACHE is ignored by compiled executables and honored by bun", () => {
  const dir = tempDirWithFiles("compile-node-compile-cache", {
    "app.js": `
        const ext = require(process.env.EXT_MOD);
        console.log("APP_OK", ext.value);
      `,
    "extmod.cjs": `module.exports = { value: 42 };`,
    "cache-standalone/.keep": "",
    "cache-bun/.keep": "",
  });

  const build = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "./app.js", "--outfile=app-compiled"],
    env: bunEnv,
    cwd: dir,
  });
  expect(build.exitCode).toBe(0);

  const standalone = Bun.spawnSync({
    cmd: [join(dir, "app-compiled")],
    env: {
      ...bunEnv,
      EXT_MOD: join(dir, "extmod.cjs"),
      NODE_COMPILE_CACHE: join(dir, "cache-standalone"),
      // Debug ASAN builds embed an @executable_path rpath for asan-dyld-shim.dylib;
      // the standalone exe lives elsewhere, so point dyld back at the build dir.
      DYLD_FALLBACK_LIBRARY_PATH: dirname(bunExe()),
    },
    cwd: dir,
  });
  expect(standalone.stdout.toString()).toContain("APP_OK 42");
  expect(standalone.exitCode).toBe(0);
  expect(readdirSync(join(dir, "cache-standalone"))).toEqual([".keep"]);

  const plain = Bun.spawnSync({
    cmd: [bunExe(), "app.js"],
    env: {
      ...bunEnv,
      EXT_MOD: join(dir, "extmod.cjs"),
      NODE_COMPILE_CACHE: join(dir, "cache-bun"),
    },
    cwd: dir,
  });
  expect(plain.stdout.toString()).toContain("APP_OK 42");
  expect(plain.exitCode).toBe(0);
  expect(readdirSync(join(dir, "cache-bun")).length).toBeGreaterThan(1);
}, 240_000);
