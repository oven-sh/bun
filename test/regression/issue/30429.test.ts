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
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("bare-specifier virtual CJS module does not panic on transpiler-cache hit", async () => {
  // A CJS file large enough that the transpiler cache stores it
  // (MINIMUM_CACHE_SIZE is 50 KiB). The content must match between the
  // primer run and the virtual module so that `RuntimeTranspilerCache.get`
  // (keyed by content hash) restores it.
  const payload = "// " + Buffer.alloc(80 * 1024, "x").toString() + "\nmodule.exports = { ok: true };\n";

  using dir = tempDir("issue-30429", {
    "primer.cjs": payload,
    "fixture.ts": `
      const { readFileSync } = require("fs");
      const { join } = require("path");
      const payload = readFileSync(join(__dirname, "primer.cjs"), "utf8");
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
  });

  const cache = join(dir + "", ".cache");
  mkdirSync(cache, { recursive: true });

  const env = {
    ...bunEnv,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache,
    BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
  };

  // Prime the cache by running the real file once.
  const primed = Bun.spawnSync({
    cmd: [bunExe(), join(dir + "", "primer.cjs")],
    env,
    stdin: "ignore",
  });
  expect(primed.exitCode).toBe(0);

  // Now require the same contents via a virtual module whose specifier has
  // no path separator. `Fs.Path.init("virtual30429.cjs")` produces
  // `name.dir == ""`, so `readDirInfo("")` is called from the CJS tag
  // detection in `jsc/ModuleLoader.zig`. Before the fix,
  // `dirInfoCachedMaybeLog` panicked on the `isAbsolute` assertion.
  const result = Bun.spawnSync({
    cmd: [bunExe(), join(dir + "", "fixture.ts")],
    env,
    stdin: "ignore",
    timeout: 10_000,
  });

  // Assert stdout first so that diagnostics surface clearly when the
  // subprocess exits non-zero. Don't pin stderr to an exact string —
  // ASAN lanes emit sanitizer summaries there.
  expect(result.stdout.toString().trim()).toBe("object");
  expect(result.signalCode).toBeUndefined();
  expect(result.exitCode).toBe(0);
});
