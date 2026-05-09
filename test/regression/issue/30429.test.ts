// https://github.com/oven-sh/bun/issues/30429
//
// Crash on Windows ReleaseSafe builds: "panic: Internal assertion failure:
// cannot resolve DirInfo for non-absolute path:" — triggered when the
// runtime-transpiler cache restores a CJS module whose `Fs.Path.name.dir`
// is empty (i.e. the specifier has no path separator). Reporter hit it
// with `bun eslint`. The assert is gated on `Environment.allow_assert`,
// which is true for debug and Windows ReleaseSafe builds, so the
// reproduction below panics on `bun bd` too.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { bunEnv, bunExe, tmpdirSync } from "harness";

test("bare-specifier virtual CJS module does not panic on transpiler-cache hit", async () => {
  const dir = tmpdirSync();
  const cache = join(dir, ".cache");
  mkdirSync(cache, { recursive: true });

  // A CJS file large enough that the transpiler cache stores it
  // (MINIMUM_CACHE_SIZE is 50 KiB). The content must match between the
  // primer run and the virtual module so that `RuntimeTranspilerCache.get`
  // (keyed by content hash) restores it.
  const payload =
    "// " + "x".repeat(80 * 1024) + "\nmodule.exports = { ok: true };\n";
  const primer = join(dir, "primer.cjs");
  writeFileSync(primer, payload);

  const env = {
    ...bunEnv,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache,
    BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
  };

  // Prime the cache by running the real file once.
  const primed = Bun.spawnSync({
    cmd: [bunExe(), primer],
    env,
    stdin: "ignore",
  });
  expect(primed.exitCode).toBe(0);

  // Now require the same contents via a virtual module whose specifier has
  // no path separator. `Fs.Path.init("virtual30429.cjs")` produces
  // `name.dir == ""`, so `readDirInfo("")` is called from the CJS tag
  // detection in `jsc/ModuleLoader.zig`. Before the fix,
  // `dirInfoCachedMaybeLog` panicked on the `isAbsolute` assertion.
  const fixture = join(dir, "fixture.ts");
  writeFileSync(
    fixture,
    `
    const fs = require("fs");
    const payload = fs.readFileSync(${JSON.stringify(primer)}, "utf8");
    Bun.plugin({
      name: "virt30429",
      setup(builder) {
        builder.module("virtual30429.cjs", () => ({
          contents: payload,
          loader: "js",
        }));
      },
    });
    const mod = require("virtual30429.cjs");
    console.log(typeof mod);
    `,
  );

  const result = Bun.spawnSync({
    cmd: [bunExe(), fixture],
    env,
    stdin: "ignore",
    timeout: 10_000,
  });

  expect({
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString().trim(),
    exitCode: result.exitCode,
    signalCode: result.signalCode,
  }).toEqual({
    stderr: "",
    stdout: "object",
    exitCode: 0,
    signalCode: undefined,
  });
});
