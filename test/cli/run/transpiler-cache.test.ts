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
    const a = bunRun(join(temp_dir, "a.js"), env);
    expect(a.stdout == "a");
    expect(existsSync(cache_dir)).toBeTrue();
    expect(newCacheCount()).toBe(1);
    const b = bunRun(join(temp_dir, "a.js"), env);
    expect(b.stdout == "a");
    expect(newCacheCount()).toBe(0);
  });
  test("works with empty files", async () => {
    writeFileSync(join(temp_dir, "a.js"), "//" + "a".repeat(50 * 1024 * 1.5));
    const a = bunRun(join(temp_dir, "a.js"), env);
    expect(a.stdout == "");
    expect(existsSync(cache_dir)).toBeTrue();
    expect(newCacheCount()).toBe(1);
    const b = bunRun(join(temp_dir, "a.js"), env);
    expect(b.stdout == "");
    expect(newCacheCount()).toBe(0);
  });
  test("ignores files under the minimum cache size", async () => {
    // MINIMUM_CACHE_SIZE is 4 KiB (src/jsc/RuntimeTranspilerCache.rs); files
    // below it skip the cache entirely so a stat+open+read can't be slower than
    // just re-transpiling.
    writeFileSync(join(temp_dir, "a.js"), dummyFile(4 * 1024 - 1, "1", "a"));
    const a = bunRun(join(temp_dir, "a.js"), env);
    expect(a.stdout == "a");
    expect(!existsSync(cache_dir)).toBeTrue();
  });
  test("it is indeed content addressable", async () => {
    writeFileSync(join(temp_dir, "a.js"), dummyFile(50 * 1024, "1", "b"));
    const a = bunRun(join(temp_dir, "a.js"), env);
    expect(a.stdout == "b");
    expect(newCacheCount()).toBe(1);

    writeFileSync(join(temp_dir, "a.js"), dummyFile(50 * 1024, "1", "c"));
    const b = bunRun(join(temp_dir, "a.js"), env);
    expect(b.stdout == "c");
    expect(newCacheCount()).toBe(1);

    writeFileSync(join(temp_dir, "b.js"), dummyFile(50 * 1024, "1", "b"));
    const c = bunRun(join(temp_dir, "b.js"), env);
    expect(b.stdout == "b");
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
  test("disables the cache instead of falling back to the shared temp directory", () => {
    writeFileSync(join(temp_dir, "a.js"), dummyFile((50 * 1024 * 1.5) | 0, "1", "no-tmpdir-cache"));

    // Stand-in for the shared, world-writable system temp dir. Pre-create
    // bun/@t@ inside it the way another local user could on a multi-user host.
    const shared_tmp = join(temp_dir, "shared-tmp");
    const shared_cache = join(shared_tmp, "bun", "@t@");
    mkdirSync(shared_cache, { recursive: true });

    // No per-user cache location is available (no BUN_RUNTIME_TRANSPILER_CACHE_PATH,
    // no XDG_CACHE_HOME, no HOME) — the only remaining candidate is the shared
    // temp dir, so the cache must be disabled instead of using it.
    const a = bunRun(join(temp_dir, "a.js"), {
      ...env,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: undefined,
      XDG_CACHE_HOME: undefined,
      HOME: undefined,
      USERPROFILE: undefined,
      BUN_TMPDIR: undefined,
      TMPDIR: shared_tmp,
      TMP: shared_tmp,
      TEMP: shared_tmp,
    });
    expect(a.stdout).toBe("no-tmpdir-cache");

    // No cache entry may be written into (or read back from) a directory that
    // another local user could own and pre-populate.
    expect(readdirSync(shared_cache)).toEqual([]);

    // A per-user cache location still works.
    const b = bunRun(join(temp_dir, "a.js"), env);
    expect(b.stdout).toBe("no-tmpdir-cache");
    expect(newCacheCount()).toBe(1);
  });
  test("works if the cache is not user-readable", () => {
    mkdirSync(cache_dir, { recursive: true });
    writeFileSync(join(temp_dir, "a.js"), dummyFile((50 * 1024 * 1.5) | 0, "1", "b"));
    const a = bunRun(join(temp_dir, "a.js"), env);
    expect(a.stdout == "b");
    expect(newCacheCount()).toBe(1);

    const cache_item = readdirSync(cache_dir)[0];

    chmodSync(join(cache_dir, cache_item), 0);
    const b = bunRun(join(temp_dir, "a.js"), env);
    expect(b.stdout == "b");
    expect(newCacheCount()).toBe(0);

    chmodSync(join(cache_dir), "0");
    try {
      const c = bunRun(join(temp_dir, "a.js"), env);
      expect(c.stdout == "b");
    } finally {
      chmodSync(join(cache_dir), "777");
    }
  });
  test("works if the cache is not user-writable", () => {
    mkdirSync(cache_dir, { recursive: true });
    writeFileSync(join(temp_dir, "a.js"), dummyFile((50 * 1024 * 1.5) | 0, "1", "b"));

    try {
      chmodSync(join(cache_dir), "0");
      const a = bunRun(join(temp_dir, "a.js"), env);
      expect(a.stdout == "b");
    } finally {
      chmodSync(join(cache_dir), "777");
    }
  });
  test("does not inline process.env", () => {
    writeFileSync(
      join(temp_dir, "a.js"),
      dummyFile((50 * 1024 * 1.5) | 0, "1", { code: "process.env.NODE_ENV, process.env.HELLO" }),
    );
    const a = bunRun(join(temp_dir, "a.js"), { ...env, NODE_ENV: undefined, HELLO: "1" });
    expect(a.stdout == "development 1");
    expect(existsSync(cache_dir)).toBeTrue();
    expect(newCacheCount()).toBe(1);
    const b = bunRun(join(temp_dir, "a.js"), { ...env, NODE_ENV: "production", HELLO: "5" });
    expect(b.stdout == "production 5");
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
});

test("never loads or deletes `.pile` entries from the Zig-line cache namespace", () => {
  // The Zig 1.3.x maintenance line shares this cache's directory and hashing,
  // but transpiles with a different implementation and bumps its on-disk
  // expected_version independently (bun-v1.3.13/1.3.14 use 20; Rust canaries
  // used 20-22 before moving to `.pile2`). While both lines wrote
  // `<hash>.pile`, a version-number collision made each implementation fully
  // trust entries produced by the other — every stored hash verifies (they
  // hash the entry's own payload) — so foreign transpiler output was served
  // forever and survived version up/downgrades. The Rust line therefore
  // writes `.pile2` filenames: `.pile` files must never be loaded (even when
  // hash-valid and version-matching) and never deleted (they belong to the
  // other line's cache).
  //
  // Cache entry layout (src/jsc/RuntimeTranspilerCache.rs, Metadata::encode):
  //   0: cache_version u32, 4: module_type u8, 5: output_encoding u8,
  //   6: features_hash u64, 14: input_byte_length u64, 22: input_hash u64,
  //   30: output_byte_offset u64, 38: output_byte_length u64,
  //   46: output_hash u64, then sourcemap/esm_record triples; payload @ 102.
  const CACHE_VERSION_AT = 0;
  const OUTPUT_BYTE_OFFSET_AT = 30;
  const OUTPUT_BYTE_LENGTH_AT = 38;
  const OUTPUT_HASH_AT = 46;
  const WYHASH_SEED = 42n;

  // Long enough that the transpiled output region can hold the sentinel.
  const original = "original-output-".repeat(16);

  writeFileSync(join(temp_dir, "a.js"), dummyFile(8 * 1024, "impl-line", original));

  const first = bunRun(join(temp_dir, "a.js"), env);
  expect(first.stdout).toBe(original);
  expect(newCacheCount()).toBe(1);

  // Forge the entry a Zig-line bun would have written for this exact source:
  // `<hash>.pile` name, same metadata (input_hash/features_hash untouched),
  // different transpiled output, all self-hashes valid. Version 22 is the
  // last version the Rust line shipped under the shared `.pile` name and
  // stands in for any Zig-line bump reaching the same number.
  const written = readdirSync(cache_dir)[0];
  const data = readFileSync(join(cache_dir, written));
  const outputOffset = Number(data.readBigUInt64LE(OUTPUT_BYTE_OFFSET_AT));
  const outputLength = Number(data.readBigUInt64LE(OUTPUT_BYTE_LENGTH_AT));
  const sentinel = `console.log("POISONED");`;
  expect(outputLength).toBeGreaterThanOrEqual(sentinel.length);
  const foreignOutput = Buffer.alloc(outputLength, "\n");
  foreignOutput.write(sentinel, 0, "utf-8");

  data.writeUInt32LE(22, CACHE_VERSION_AT);
  foreignOutput.copy(data, outputOffset);
  data.writeBigUInt64LE(Bun.hash.wyhash(foreignOutput, WYHASH_SEED), OUTPUT_HASH_AT);

  // Plant it under the legacy `.pile` name (strip the trailing "2"; covers
  // `.debug.pile2` on debug builds) and leave nothing else in the cache, so
  // the only way to "hit" is to read the foreign namespace.
  const legacy = written.replace(/\.pile2$/, ".pile");
  const legacyFile = join(cache_dir, legacy);
  writeFileSync(legacyFile, data);
  if (legacy !== written) rmSync(join(cache_dir, written));
  prev_cache_count = 1;

  // The foreign entry must not be served: the source is re-transpiled and a
  // fresh `.pile2` entry written alongside the untouched `.pile` file.
  const second = bunRun(join(temp_dir, "a.js"), env);
  expect(second.stdout).toBe(original);
  expect(newCacheCount()).toBe(1);

  const after = readdirSync(cache_dir).sort();
  expect(after).toContain(legacy);
  expect(after.filter(n => n.endsWith(".pile2"))).toHaveLength(1);
  // Byte-identical: never loaded-and-rewritten, never unlinked.
  expect(readFileSync(legacyFile)).toEqual(data);

  // And the `.pile2` entry is trusted on the next run: the sentinel hidden in
  // the `.pile` file never surfaces no matter how often this re-runs.
  const third = bunRun(join(temp_dir, "a.js"), env);
  expect(third.stdout).toBe(original);
  expect(newCacheCount()).toBe(0);
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
