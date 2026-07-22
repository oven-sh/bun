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

// Cache entry layout (src/jsc/RuntimeTranspilerCache.rs, Metadata::encode):
//   0: cache_version u32, 4: module_type u8, 5: output_encoding u8,
//   then twelve u64 fields at offsets 6..102. Payload follows @ 102.
const METADATA_SIZE = 102;
const OUTPUT_BYTE_OFFSET_AT = 30;
const OUTPUT_BYTE_LENGTH_AT = 38;
const OUTPUT_HASH_AT = 46;
const SOURCEMAP_BYTE_OFFSET_AT = 54;
const SOURCEMAP_BYTE_LENGTH_AT = 62;
const SOURCEMAP_HASH_AT = 70;
const ESM_RECORD_BYTE_OFFSET_AT = 78;
const ESM_RECORD_BYTE_LENGTH_AT = 86;
const ESM_RECORD_HASH_AT = 94;
// Wyhash seed used by RuntimeTranspilerCache::hash().
const CACHE_WYHASH_SEED = 42n;

test("rejects a cache entry whose output_hash is zeroed", () => {
  // The on-disk transpiler cache entry stores a wyhash of the transpiled
  // output in the header. On load the hash of the output bytes is compared
  // against that stored value. A stored hash of zero must not skip that
  // check: anyone who can write to the cache directory can compute the
  // cache filename for a known source file, prepend arbitrary code to the
  // cached output, and zero the stored output_hash so the altered output
  // is accepted without being re-verified.

  // A >=4 KiB source file so it is eligible for the cache.
  writeFileSync(join(temp_dir, "a.js"), dummyFile(50 * 1024, "output-hash-zero", "clean"));

  // First run transpiles the file and writes the cache entry.
  const first = bunRun(join(temp_dir, "a.js"), env);
  expect(first.stdout).toBe("clean");
  expect(newCacheCount()).toBe(1);
  const pile = join(cache_dir, readdirSync(cache_dir)[0]);

  // Rewrite the cached output: prepend a payload, then zero output_hash so the
  // only integrity check on the output bytes is bypassed.
  const data = readFileSync(pile);
  const outOff = Number(data.readBigUInt64LE(OUTPUT_BYTE_OFFSET_AT));
  const outLen = Number(data.readBigUInt64LE(OUTPUT_BYTE_LENGTH_AT));
  const smOff = Number(data.readBigUInt64LE(SOURCEMAP_BYTE_OFFSET_AT));
  const smLen = Number(data.readBigUInt64LE(SOURCEMAP_BYTE_LENGTH_AT));
  const esmOff = Number(data.readBigUInt64LE(ESM_RECORD_BYTE_OFFSET_AT));
  const esmLen = Number(data.readBigUInt64LE(ESM_RECORD_BYTE_LENGTH_AT));

  const payload = Buffer.from('console.log("PLANTED");\n');
  const newOut = Buffer.concat([payload, data.subarray(outOff, outOff + outLen)]);
  const sm = data.subarray(smOff, smOff + smLen);
  const esm = data.subarray(esmOff, esmOff + esmLen);

  const header = Buffer.from(data.subarray(0, METADATA_SIZE));
  header.writeBigUInt64LE(BigInt(METADATA_SIZE), OUTPUT_BYTE_OFFSET_AT);
  header.writeBigUInt64LE(BigInt(newOut.length), OUTPUT_BYTE_LENGTH_AT);
  header.writeBigUInt64LE(0n, OUTPUT_HASH_AT);
  header.writeBigUInt64LE(BigInt(METADATA_SIZE + newOut.length), SOURCEMAP_BYTE_OFFSET_AT);
  header.writeBigUInt64LE(BigInt(METADATA_SIZE + newOut.length + sm.length), ESM_RECORD_BYTE_OFFSET_AT);
  writeFileSync(pile, Buffer.concat([header, newOut, sm, esm]));

  // Second run must not execute the planted payload. The entry's integrity
  // check fails, so the cache entry is discarded and the source file is
  // re-transpiled from scratch.
  const second = bunRun(join(temp_dir, "a.js"), env);
  expect(second.stdout).toBe("clean");
});

test("rejects cached module records containing out-of-range string indices", () => {
  // When test isolation is enabled, the runtime transpiler cache stores a
  // serialized ES module record ("esm_record") alongside the transpiled
  // output. The string indices inside that record are used to index an
  // identifier table when the record is converted back into a JSC module
  // record, so any index beyond the table length (other than the reserved
  // *-default / *-namespace sentinels near u32::MAX) must be rejected.
  //
  // Serialized module record layout (src/bundler/analyze_transpiled_module.rs,
  // serialize()):
  //   [record_kinds_len u32][record_kinds, 1 byte each][pad to 4]
  //   [buffer_len u32][buffer: u32 string index x buffer_len] ...

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
    // Re-derive the stored esm_record hash so the corrupted record still
    // passes the loader's integrity check and reaches the deserializer under
    // test. The loader uses the same wyhash variant and seed as
    // Bun.hash.wyhash.
    data.writeBigUInt64LE(Bun.hash.wyhash(data.subarray(esmOff, esmOff + esmLen), CACHE_WYHASH_SEED), ESM_RECORD_HASH_AT);
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
