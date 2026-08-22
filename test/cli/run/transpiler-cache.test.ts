import { Subprocess } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, tmpdirSync } from "harness";
import { join } from "path";

function dummyFile(size: number, cache_bust: string, value: string | { code: string }) {
  const data = Buffer.alloc(size);
  data.write("/*" + cache_bust);
  const end = `*/\nconsole.log(${(value as any).code ?? JSON.stringify(value)});`;
  data.fill("*", 2 + cache_bust.length, size - end.length, "utf-8");
  data.write(end, size - end.length, "utf-8");
  return data;
}

let temp_dir: string = "";
let cache_dir = "";

const env = {
  ...bunEnv,
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache_dir,
  BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
};

let prev_cache_count = 0;
function newCacheCount() {
  let new_count = readdirSync(cache_dir).length;
  let delta = new_count - prev_cache_count;
  prev_cache_count = new_count;
  return delta;
}

function removeCache() {
  prev_cache_count = 0;
  try {
    rmSync(cache_dir, { recursive: true, force: true });
  } catch (error) {
    chmodSync(cache_dir, 0o777);
    readdirSync(cache_dir).forEach(item => {
      chmodSync(join(cache_dir, item), 0o777);
    });
    rmSync(cache_dir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  if (cache_dir) {
    rmSync(temp_dir, { recursive: true, force: true });
    removeCache();
  }

  temp_dir = tmpdirSync();
  mkdirSync(temp_dir, { recursive: true });
  temp_dir = realpathSync(temp_dir);
  cache_dir = join(temp_dir, ".cache");
  env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = cache_dir;
});

describe("transpiler cache", () => {
  test("works", async () => {
    writeFileSync(join(temp_dir, "a.js"), dummyFile((50 * 1024 * 1.5) | 0, "1", "a"));
    expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("a");
    expect(existsSync(cache_dir)).toBeTrue();
    expect(newCacheCount()).toBe(1);
    expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("a");
    expect(newCacheCount()).toBe(0);
  });
  test("works with empty files", async () => {
    writeFileSync(join(temp_dir, "a.js"), "//" + "a".repeat(50 * 1024 * 1.5));
    expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("");
    expect(existsSync(cache_dir)).toBeTrue();
    expect(newCacheCount()).toBe(1);
    expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("");
    expect(newCacheCount()).toBe(0);
  });
  test("ignores files under the minimum cache size", async () => {
    // MINIMUM_CACHE_SIZE is 4 KiB (src/jsc/RuntimeTranspilerCache.rs); files
    // below it skip the cache entirely so a stat+open+read can't be slower than
    // just re-transpiling.
    writeFileSync(join(temp_dir, "a.js"), dummyFile(4 * 1024 - 1, "1", "a"));
    expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("a");
    expect(!existsSync(cache_dir)).toBeTrue();
  });
  test("it is indeed content addressable", async () => {
    writeFileSync(join(temp_dir, "a.js"), dummyFile(50 * 1024, "1", "b"));
    expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("b");
    expect(newCacheCount()).toBe(1);

    writeFileSync(join(temp_dir, "a.js"), dummyFile(50 * 1024, "1", "c"));
    expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("c");
    expect(newCacheCount()).toBe(1);

    writeFileSync(join(temp_dir, "b.js"), dummyFile(50 * 1024, "1", "b"));
    expect(await bunRun(join(temp_dir, "b.js"), env)).toSpawn("b");
    expect(newCacheCount()).toBe(0);
  });
  test("doing 50 buns at once does not crash", async () => {
    writeFileSync(join(temp_dir, "a.js"), dummyFile(50 * 1024, "1", "b"));
    writeFileSync(join(temp_dir, "b.js"), dummyFile(50 * 1024, "2", "b"));

    const remover = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "transpiler-cache-aggressive-remover.js"), cache_dir],
      env,
      cwd: temp_dir,
    });

    let processes: Subprocess<"ignore", "pipe", "inherit">[] = [];
    let killing = false;
    for (let i = 0; i < 50; i++) {
      processes.push(
        Bun.spawn({
          cmd: [bunExe(), i % 2 == 0 ? "a.js" : "b.js"],
          env,
          cwd: temp_dir,
          onExit(subprocess, exitCode, signalCode, error) {
            if (exitCode != 0 && !killing) {
              killing = true;
              processes.forEach(x => x.kill(9));
              remover.kill(9);
            }
          },
        }),
      );
    }

    await Promise.all(processes.map(x => x.exited));

    expect(!killing).toBeTrue();

    remover.kill(9);

    for (const proc of processes) {
      expect(proc.exitCode).toBe(0);
      expect(await proc.stdout.text()).toBe("b\n");
    }
  }, 99999999);
  test("disables the cache instead of falling back to the shared temp directory", async () => {
    writeFileSync(join(temp_dir, "a.js"), dummyFile((50 * 1024 * 1.5) | 0, "1", "no-tmpdir-cache"));

    // Stand-in for the shared, world-writable system temp dir. Pre-create
    // bun/@t@ inside it the way another local user could on a multi-user host.
    const shared_tmp = join(temp_dir, "shared-tmp");
    const shared_cache = join(shared_tmp, "bun", "@t@");
    mkdirSync(shared_cache, { recursive: true });

    // No per-user cache location is available (no BUN_RUNTIME_TRANSPILER_CACHE_PATH,
    // no XDG_CACHE_HOME, no HOME) — the only remaining candidate is the shared
    // temp dir, so the cache must be disabled instead of using it.
    expect(
      await bunRun(join(temp_dir, "a.js"), {
        ...env,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: undefined,
        XDG_CACHE_HOME: undefined,
        HOME: undefined,
        USERPROFILE: undefined,
        BUN_TMPDIR: undefined,
        TMPDIR: shared_tmp,
        TMP: shared_tmp,
        TEMP: shared_tmp,
      }),
    ).toSpawn("no-tmpdir-cache");

    // No cache entry may be written into (or read back from) a directory that
    // another local user could own and pre-populate.
    expect(readdirSync(shared_cache)).toEqual([]);

    // A per-user cache location still works.
    expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("no-tmpdir-cache");
    expect(newCacheCount()).toBe(1);
  });
  test("works if the cache is not user-readable", async () => {
    mkdirSync(cache_dir, { recursive: true });
    writeFileSync(join(temp_dir, "a.js"), dummyFile((50 * 1024 * 1.5) | 0, "1", "b"));
    expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("b");
    expect(newCacheCount()).toBe(1);

    const cache_item = readdirSync(cache_dir)[0];

    chmodSync(join(cache_dir, cache_item), 0);
    expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("b");
    expect(newCacheCount()).toBe(0);

    chmodSync(join(cache_dir), "0");
    try {
      expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("b");
    } finally {
      chmodSync(join(cache_dir), "777");
    }
  });
  test("works if the cache is not user-writable", async () => {
    mkdirSync(cache_dir, { recursive: true });
    writeFileSync(join(temp_dir, "a.js"), dummyFile((50 * 1024 * 1.5) | 0, "1", "b"));

    try {
      chmodSync(join(cache_dir), "0");
      expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("b");
    } finally {
      chmodSync(join(cache_dir), "777");
    }
  });
  test("does not inline process.env", async () => {
    writeFileSync(
      join(temp_dir, "a.js"),
      dummyFile((50 * 1024 * 1.5) | 0, "1", { code: "process.env.NODE_ENV, process.env.HELLO" }),
    );
    expect(await bunRun(join(temp_dir, "a.js"), { ...env, NODE_ENV: undefined, HELLO: "1" })).toSpawn("undefined 1");
    expect(existsSync(cache_dir)).toBeTrue();
    expect(newCacheCount()).toBe(1);
    expect(await bunRun(join(temp_dir, "a.js"), { ...env, NODE_ENV: "production", HELLO: "5" })).toSpawn(
      "production 5",
    );
    expect(newCacheCount()).toBe(0);
  });
  test("--feature flag invalidates cache", () => {
    // feature() can only appear in an if/ternary, so wrap it
    const code = `import { feature } from "bun:bundle";\nif (feature("SUPER_SECRET")) console.log("enabled"); else console.log("disabled");`;
    const filler = Buffer.alloc((50 * 1024 * 1.5) | 0, "/").toString();
    writeFileSync(join(temp_dir, "a.js"), code + "\n//" + filler);

    const run = (extra: string[]) => {
      const result = Bun.spawnSync({
        cmd: [bunExe(), ...extra, "a.js"],
        cwd: temp_dir,
        env,
      });
      if (!result.success) throw new Error(result.stderr.toString());
      return result.stdout.toString().trim();
    };

    // First run with flag: cache miss, write entry
    expect(run(["--feature=SUPER_SECRET"])).toBe("enabled");
    expect(newCacheCount()).toBe(1);

    // Same flag: cache hit
    expect(run(["--feature=SUPER_SECRET"])).toBe("enabled");
    expect(newCacheCount()).toBe(0);

    // No flag: features_hash differs -> old entry deleted, new entry written
    expect(run([])).toBe("disabled");
    expect(newCacheCount()).toBe(0); // deleted + written = net 0

    // Flag again: another delete + write
    expect(run(["--feature=SUPER_SECRET"])).toBe("enabled");
    expect(newCacheCount()).toBe(0);

    // Multiple flags, different order: same hash, cache hit
    expect(run(["--feature=SUPER_SECRET", "--feature=OTHER"])).toBe("enabled");
    expect(newCacheCount()).toBe(0); // delete + write
    expect(run(["--feature=OTHER", "--feature=SUPER_SECRET"])).toBe("enabled");
    expect(newCacheCount()).toBe(0); // cache hit, order doesn't matter
  });

  // Everything below changes the transpiled output of the same source bytes, so
  // an entry written by one configuration must never be served to another. Each
  // is part of the features hash, like --feature above: a different
  // configuration replaces the entry (delete + write, net 0 new files), the same
  // one hits it.
  describe("the configuration is part of the cache key", () => {
    // Prints what X was defined as, or "nodefine" when it was left alone.
    const defineProbe = { code: 'typeof X === "undefined" ? "nodefine" : X' };

    // Returns the last line the file printed. (`bun test` reports on stderr, but
    // also prints its version banner to stdout ahead of the module's output.)
    function run(args: string[]) {
      const result = Bun.spawnSync({
        cmd: [bunExe(), ...args],
        cwd: temp_dir,
        env,
        stdin: "ignore",
      });
      const stdout = result.stdout.toString().trim();
      expect({ stdout, stderr: result.stderr.toString(), exitCode: result.exitCode }).toMatchObject({ exitCode: 0 });
      return stdout.split("\n").at(-1);
    }

    // Every configuration of a.js shares one entry (the file name is the hash
    // of the source), so this is the entry as last written.
    const cacheEntry = () => readFileSync(join(cache_dir, readdirSync(cache_dir)[0]));

    test("--define", () => {
      writeFileSync(join(temp_dir, "a.js"), dummyFile(5 * 1024, "1", defineProbe));

      expect(run(["--define", 'X="cli"', "a.js"])).toBe("cli");
      expect(existsSync(cache_dir)).toBeTrue();
      expect(newCacheCount()).toBe(1);
      const withDefine = cacheEntry();

      expect(run(["--define", 'X="cli"', "a.js"])).toBe("cli");
      expect(newCacheCount()).toBe(0);
      expect(cacheEntry()).toEqual(withDefine);

      expect(run(["a.js"])).toBe("nodefine");
      expect(newCacheCount()).toBe(0);
      expect(cacheEntry()).not.toEqual(withDefine);

      expect(run(["--define", 'X="other"', "a.js"])).toBe("other");
      expect(newCacheCount()).toBe(0);

      expect(run(["--define", 'X="cli"', "a.js"])).toBe("cli");
      expect(newCacheCount()).toBe(0);
      expect(cacheEntry()).toEqual(withDefine);

      // The order the defines are given in does not change the key.
      expect(run(["--define", 'X="cli"', "--define", "Y=1", "a.js"])).toBe("cli");
      expect(newCacheCount()).toBe(0);
      const twoDefines = cacheEntry();
      expect(twoDefines).not.toEqual(withDefine);
      expect(run(["--define", "Y=1", "--define", 'X="cli"', "a.js"])).toBe("cli");
      expect(newCacheCount()).toBe(0);
      expect(cacheEntry()).toEqual(twoDefines);

      // ...unless the same key is given twice: the last one wins, so these are
      // two different configurations, and the second is the same one as a
      // plain X=1.
      expect(run(["--define", "X=1", "--define", "X=2", "a.js"])).toBe("2");
      expect(newCacheCount()).toBe(0);
      expect(run(["--define", "X=2", "--define", "X=1", "a.js"])).toBe("1");
      expect(newCacheCount()).toBe(0);
      const lastWins = cacheEntry();
      expect(run(["--define", "X=1", "a.js"])).toBe("1");
      expect(newCacheCount()).toBe(0);
      expect(cacheEntry()).toEqual(lastWins);
    });

    test("--define passed to bun test", () => {
      // The test file itself is too small to be cached; the module it imports
      // is not, and is the same module `bun a.js` loads.
      writeFileSync(join(temp_dir, "a.js"), dummyFile(5 * 1024, "1", defineProbe));
      writeFileSync(
        join(temp_dir, "a.test.js"),
        `import "./a.js";\nimport { test } from "bun:test";\ntest("x", () => {});\n`,
      );

      expect(run(["test", "--define", 'X="cli"', "./a.test.js"])).toBe("cli");
      expect(newCacheCount()).toBe(1);

      expect(run(["test", "./a.test.js"])).toBe("nodefine");
      expect(newCacheCount()).toBe(0);
      expect(run(["a.js"])).toBe("nodefine");
      expect(newCacheCount()).toBe(0);

      expect(run(["test", "--define", 'X="cli"', "./a.test.js"])).toBe("cli");
      expect(newCacheCount()).toBe(0);
      expect(run(["a.js"])).toBe("nodefine");
      expect(newCacheCount()).toBe(0);
    });

    test("define from bunfig.toml", () => {
      // `bun run <file>` reads bunfig.toml only after the command line has
      // been parsed; the defines it adds have to be keyed like --define.
      writeFileSync(join(temp_dir, "a.js"), dummyFile(5 * 1024, "1", defineProbe));
      writeFileSync(join(temp_dir, "bunfig.toml"), `[define]\nX = '"bunfig"'\n`);

      expect(run(["run", "a.js"])).toBe("bunfig");
      expect(newCacheCount()).toBe(1);
      expect(run(["a.js"])).toBe("bunfig");
      expect(newCacheCount()).toBe(0);

      rmSync(join(temp_dir, "bunfig.toml"));
      expect(run(["run", "a.js"])).toBe("nodefine");
      expect(newCacheCount()).toBe(0);
      expect(run(["a.js"])).toBe("nodefine");
      expect(newCacheCount()).toBe(0);
    });

    test("--drop", () => {
      writeFileSync(join(temp_dir, "a.js"), dummyFile(5 * 1024, "1", "console-kept"));

      expect(run(["a.js"])).toBe("console-kept");
      expect(newCacheCount()).toBe(1);

      expect(run(["--drop=console", "a.js"])).toBe("");
      expect(newCacheCount()).toBe(0);
      expect(run(["--drop=console", "a.js"])).toBe("");
      expect(newCacheCount()).toBe(0);

      expect(run(["a.js"])).toBe("console-kept");
      expect(newCacheCount()).toBe(0);
    });

    test('package.json "type" and the .cjs / .mjs extension', () => {
      // The same bytes under every module type, so all four files share one
      // entry. The module type decides whether a file without import/export
      // syntax is wrapped as CommonJS, where `arguments` exists.
      const source = dummyFile(5 * 1024, "1", { code: "typeof arguments" });
      mkdirSync(join(temp_dir, "cjs"));
      mkdirSync(join(temp_dir, "esm"));
      writeFileSync(join(temp_dir, "cjs", "package.json"), `{ "type": "commonjs" }`);
      writeFileSync(join(temp_dir, "esm", "package.json"), `{ "type": "module" }`);
      for (const file of ["cjs/a.js", "esm/a.js", "a.cjs", "a.mjs"]) {
        writeFileSync(join(temp_dir, file), source);
      }

      expect(run(["cjs/a.js"])).toBe("object");
      expect(newCacheCount()).toBe(1);
      expect(run(["esm/a.js"])).toBe("undefined");
      expect(newCacheCount()).toBe(0);
      expect(run(["a.cjs"])).toBe("object");
      expect(newCacheCount()).toBe(0);
      expect(run(["a.mjs"])).toBe("undefined");
      expect(newCacheCount()).toBe(0);
    });

    test("--jsx-side-effects", () => {
      // With the classic runtime an unused element is a bare call to the
      // factory, which is dropped as dead code unless --jsx-side-effects says
      // the call matters. (The flag is read together with the other JSX flags.)
      const classic = ["--jsx-runtime=classic", "--jsx-factory=h"];
      const code = `function h() { console.log("h called"); }\n<div />;`;
      const filler = Buffer.alloc(5 * 1024, "/").toString();
      writeFileSync(join(temp_dir, "a.jsx"), code + "\n//" + filler);

      expect(run([...classic, "a.jsx"])).toBe("");
      expect(newCacheCount()).toBe(1);
      expect(run([...classic, "--jsx-side-effects", "a.jsx"])).toBe("h called");
      expect(newCacheCount()).toBe(0);
      expect(run([...classic, "a.jsx"])).toBe("");
      expect(newCacheCount()).toBe(0);
    });
  });

  // Serving the entry point from the cache must not change how the modules it
  // loads are resolved. Both of these are gated on the `has_loaded` flag, which
  // used to be set only on the path that runs the printer.
  describe("a cached entry point does not change how later modules load", () => {
    // Padding so the entry point clears MINIMUM_CACHE_SIZE (4 KiB) and is
    // eligible for the cache at all.
    const filler = "\n//" + Buffer.alloc(5 * 1024, "f").toString();

    test("require.extensions is still consulted", async () => {
      writeFileSync(
        join(temp_dir, "entry.js"),
        `require.extensions[".data"] = (module, filename) => {
           module.exports = "custom-loader";
         };
         console.log(require("./asset.data"));${filler}`,
      );
      // If the custom loader is skipped, this is transpiled as JS/TS instead.
      writeFileSync(join(temp_dir, "asset.data"), `module.exports = "default-loader";`);

      expect(await bunRun(join(temp_dir, "entry.js"), env)).toSpawn("custom-loader");
      expect(newCacheCount()).toBe(1);

      expect(await bunRun(join(temp_dir, "entry.js"), env)).toSpawn("custom-loader");
      expect(newCacheCount()).toBe(0);
    });

    test("unknown extensions still use the file loader", async () => {
      writeFileSync(
        join(temp_dir, "entry.mjs"),
        `import asset from "./asset.someext";
         console.log(typeof asset === "string" ? "file-loader" : "???");${filler}`,
      );
      // Not valid JS/TS, so a non-file loader fails the run outright.
      writeFileSync(join(temp_dir, "asset.someext"), `hello world contents\n`);

      expect(await bunRun(join(temp_dir, "entry.mjs"), env)).toSpawn("file-loader");
      expect(newCacheCount()).toBe(1);

      expect(await bunRun(join(temp_dir, "entry.mjs"), env)).toSpawn("file-loader");
      expect(newCacheCount()).toBe(0);
    });
  });
});

test("rejects cached module records containing out-of-range string indices", () => {
  // When test isolation is enabled, the runtime transpiler cache stores a
  // serialized ES module record ("esm_record") alongside the transpiled
  // output. The string indices inside that record are used to index an
  // identifier table when the record is converted back into a JSC module
  // record, so any index beyond the table length (other than the reserved
  // *-default / *-namespace sentinels near u32::MAX) must be rejected.
  //
  // Cache entry layout (src/jsc/RuntimeTranspilerCache.rs, Metadata::encode):
  //   0: cache_version u32, 4: module_type u8, 5: output_encoding u8,
  //   then twelve u64 fields; esm_record_byte_offset @ 78,
  //   esm_record_byte_length @ 86, esm_record_hash @ 94. Payload follows @ 102.
  // Serialized module record layout (src/bundler/analyze_transpiled_module.rs,
  // serialize()):
  //   [record_kinds_len u32][record_kinds, 1 byte each][pad to 4]
  //   [buffer_len u32][buffer: u32 string index x buffer_len] ...
  const ESM_RECORD_BYTE_OFFSET_AT = 78;
  const ESM_RECORD_BYTE_LENGTH_AT = 86;
  const ESM_RECORD_HASH_AT = 94;
  const METADATA_SIZE = 102;

  function corruptModuleRecordStringIndices(file: string): boolean {
    const data = readFileSync(file);
    if (data.length < METADATA_SIZE) return false;
    const esmOff = Number(data.readBigUInt64LE(ESM_RECORD_BYTE_OFFSET_AT));
    const esmLen = Number(data.readBigUInt64LE(ESM_RECORD_BYTE_LENGTH_AT));
    if (esmLen === 0 || esmOff + esmLen > data.length) return false;

    const recordKindsLen = data.readUInt32LE(esmOff);
    const pad = (4 - (recordKindsLen % 4)) % 4;
    let off = esmOff + 4 + recordKindsLen + pad;
    const bufferLen = data.readUInt32LE(off);
    off += 4;
    if (bufferLen === 0) return false;

    // Point every string index in the record buffer far beyond the identifier
    // table (but below the reserved sentinel range near u32::MAX).
    for (let i = 0; i < bufferLen; i++) {
      data.writeUInt32LE(0x7fffffff, off + i * 4);
    }
    // The cache loader skips esm-record content verification when the stored
    // hash field is zero, so whoever writes the cache file controls exactly
    // what reaches the module record deserializer.
    data.writeBigUInt64LE(0n, ESM_RECORD_HASH_AT);
    writeFileSync(file, data);
    return true;
  }

  // An ES module big enough to be eligible for the transpiler cache (>= 4 KiB)
  // with imports, exports and top-level variables, so its module record
  // contains string indices of every record kind.
  const filler = ("// " + "x".repeat(120) + "\n").repeat(120);
  writeFileSync(
    join(temp_dir, "big-lib.js"),
    `import { join } from "node:path";
export const value = 42;
let counter = 0;
export function next() {
  counter += 1;
  return join("a", String(counter));
}
${filler}`,
  );
  writeFileSync(
    join(temp_dir, "uses-lib.test.js"),
    `import { test, expect } from "bun:test";
import { value, next } from "./big-lib.js";
test("cached module still works", () => {
  expect(value).toBe(42);
  expect(next().length).toBeGreaterThan(0);
});`,
  );

  const run = () =>
    Bun.spawnSync({
      // --isolate enables the isolation source-provider cache, which is the
      // code path that converts the cached module record back into a JSC
      // module record.
      cmd: [bunExe(), "test", "--isolate", "./uses-lib.test.js"],
      cwd: temp_dir,
      env,
    });

  // First run transpiles the module and writes the cache entry, including the
  // serialized module record.
  const first = run();
  expect(first.stderr.toString() + first.stdout.toString()).toContain("1 pass");
  expect(existsSync(cache_dir)).toBeTrue();
  expect(first.exitCode).toBe(0);

  // Second run restores from the intact cache entry: the legitimate record is
  // accepted and the module still works.
  const second = run();
  expect(second.stderr.toString() + second.stdout.toString()).toContain("1 pass");
  expect(second.exitCode).toBe(0);

  // Rewrite the stored module record so every string index is out of range.
  let corrupted = 0;
  for (const name of readdirSync(cache_dir)) {
    if (corruptModuleRecordStringIndices(join(cache_dir, name))) corrupted++;
  }
  expect(corrupted).toBeGreaterThanOrEqual(1);

  // Third run: the corrupted record must be rejected with a clean module load
  // error and a normal (non-signal) process exit.
  const third = run();
  expect(third.stderr.toString() + third.stdout.toString()).toContain("parseFromSourceCode failed");
  expect(third.signalCode).toBeUndefined();
  expect(third.exitCode).toBe(1);
});
