import { Subprocess } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { bunEnv, bunExe, bunRun, isWindows, tempDir, tmpdirSync } from "harness";
import { mkfifo } from "mkfifo";
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
  test("does not cache a file whose parse logged an error", async () => {
    // The parser reports the `import` next to `module.exports` after it has
    // built the AST, and the lexer reports `0foo` while the parser is being
    // constructed. Nothing may be printed or cached for such a file, or a
    // later run would serve the broken output from the cache without the error.
    const filler = "\n//" + Buffer.alloc(5 * 1024, "f").toString();
    writeFileSync(join(temp_dir, "dep.js"), `export const x = 1;`);
    writeFileSync(join(temp_dir, "mixed.js"), `import { x } from "./dep.js";\nmodule.exports = { x };` + filler);
    writeFileSync(join(temp_dir, "first.js"), `\\u0030foo = 1;` + filler);
    writeFileSync(
      join(temp_dir, "main.js"),
      `const out = {};
       for (const file of ["./mixed.js", "./first.js"]) {
         try { await import(file); } catch (e) { out["import " + file] = [e.name, e.message]; }
         try { require(file); } catch (e) { out["require " + file] = [e.name, e.message]; }
       }
       console.log(JSON.stringify(out));`,
    );
    const mixed = ["BuildMessage", "Cannot use import statement with CommonJS-only features"];
    const first = ["BuildMessage", 'Invalid identifier: "0foo"'];
    const expected = JSON.stringify({
      "import ./mixed.js": mixed,
      "require ./mixed.js": mixed,
      "import ./first.js": first,
      "require ./first.js": first,
    });
    expect(await bunRun(join(temp_dir, "main.js"), env)).toSpawn(expected);
    expect(await bunRun(join(temp_dir, "main.js"), env)).toSpawn(expected);
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
  test.skipIf(isWindows)("a fifo in place of an entry is removed instead of opened", async () => {
    writeFileSync(join(temp_dir, "a.js"), dummyFile((50 * 1024 * 1.5) | 0, "fifo", "intact"));
    expect(await bunRun(join(temp_dir, "a.js"), env)).toSpawn("intact");
    expect(newCacheCount()).toBe(1);
    const entry = join(cache_dir, readdirSync(cache_dir).find(f => f.endsWith(".pile"))!);
    const good = readFileSync(entry);
    unlinkSync(entry);
    mkfifo(entry);

    // Opening the fifo for reading would block until a writer showed up,
    // which never happens. The timeout only turns that hang into a failure.
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(temp_dir, "a.js")],
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(proc.signalCode).toBeNull();
    expect(stdout).toBe("intact\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(statSync(entry).isFile()).toBeTrue();
    expect(readFileSync(entry).equals(good)).toBeTrue();
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

  // A define replaces an identifier at parse time, so the define table is part
  // of the cache key. The cache is shared by every project of the user, and
  // keyed by source bytes, so two projects with the same file must not see
  // each other's values.
  describe("defines are part of the cache key", () => {
    const code = `console.log(typeof BVAL === "undefined" ? "undefined" : BVAL);`;
    const filler = Buffer.alloc((50 * 1024 * 1.5) | 0, "/").toString();

    const run = (cwd: string, args: string[]) => {
      const result = Bun.spawnSync({ cmd: [bunExe(), ...args], cwd, env });
      if (!result.success) throw new Error(result.stderr.toString());
      return result.stdout.toString().trim();
    };

    test("bunfig [define] invalidates cache", () => {
      // `bun run <file>` loads bunfig.toml after the command line is parsed,
      // so the define table only exists once the runtime is up.
      const projectA = join(temp_dir, "a");
      const projectB = join(temp_dir, "b");
      for (const dir of [projectA, projectB]) {
        mkdirSync(dir);
        writeFileSync(join(dir, "a.js"), code + "\n//" + filler);
      }
      const setDefine = (dir: string, value: string | null) => {
        if (value === null) rmSync(join(dir, "bunfig.toml"), { force: true });
        else writeFileSync(join(dir, "bunfig.toml"), `[define]\nBVAL = '${JSON.stringify(value)}'\n`);
      };

      setDefine(projectA, "one");
      expect(run(projectA, ["run", "./a.js"])).toBe("one");
      expect(newCacheCount()).toBe(1);
      expect(run(projectA, ["run", "./a.js"])).toBe("one");
      expect(newCacheCount()).toBe(0);

      // A new value: features_hash differs -> old entry deleted, new entry written
      setDefine(projectA, "two");
      expect(run(projectA, ["run", "./a.js"])).toBe("two");
      expect(newCacheCount()).toBe(0);

      setDefine(projectA, null);
      expect(run(projectA, ["run", "./a.js"])).toBe("undefined");
      expect(newCacheCount()).toBe(0);

      // The same source bytes in another project, with its own define
      setDefine(projectB, "mine");
      expect(run(projectB, ["run", "./a.js"])).toBe("mine");
      expect(newCacheCount()).toBe(0);
      expect(run(projectB, ["./a.js"])).toBe("mine");
      expect(newCacheCount()).toBe(0);
    });

    test("--define invalidates cache", () => {
      writeFileSync(join(temp_dir, "a.js"), code + "\n//" + filler);

      expect(run(temp_dir, ["--define", 'BVAL:"cli"', "a.js"])).toBe("cli");
      expect(existsSync(cache_dir)).toBeTrue();
      expect(newCacheCount()).toBe(1);
      expect(run(temp_dir, ["--define", 'BVAL:"cli"', "a.js"])).toBe("cli");
      expect(newCacheCount()).toBe(0);

      expect(run(temp_dir, ["--define", 'BVAL:"other"', "a.js"])).toBe("other");
      expect(newCacheCount()).toBe(0);

      expect(run(temp_dir, ["a.js"])).toBe("undefined");
      expect(newCacheCount()).toBe(0);

      expect(run(temp_dir, ["run", "--define", 'BVAL:"cli"', "./a.js"])).toBe("cli");
      expect(newCacheCount()).toBe(0);

      // The key is built from the resolved map: flag order does not matter,
      // and a key given twice keeps its last value, so `x` then `cli` is
      // served the entry that `--define BVAL:"cli"` alone wrote above.
      expect(run(temp_dir, ["--define", 'BVAL:"cli"', "--define", "OTHER:1", "a.js"])).toBe("cli");
      expect(newCacheCount()).toBe(0);
      const entry = join(cache_dir, readdirSync(cache_dir)[0]);
      const written = readFileSync(entry);
      expect(run(temp_dir, ["--define", "OTHER:1", "--define", 'BVAL:"cli"', "a.js"])).toBe("cli");
      expect(readFileSync(entry).equals(written)).toBeTrue();

      expect(run(temp_dir, ["--define", 'BVAL:"cli"', "a.js"])).toBe("cli");
      const alone = readFileSync(entry);
      expect(alone.equals(written)).toBeFalse();
      expect(run(temp_dir, ["--define", 'BVAL:"x"', "--define", 'BVAL:"cli"', "a.js"])).toBe("cli");
      expect(readFileSync(entry).equals(alone)).toBeTrue();
      expect(newCacheCount()).toBe(0);
    });

    test("--define passed to bun test invalidates cache", () => {
      // `bun test` builds its define table on its own boot path. The test file
      // is below the minimum cache size; the module it imports is not, and
      // `bun a.js` loads that same module.
      writeFileSync(join(temp_dir, "a.js"), code + "\n//" + filler);
      writeFileSync(
        join(temp_dir, "a.test.js"),
        `import "./a.js";\nimport { test } from "bun:test";\ntest("x", () => {});\n`,
      );
      // `bun test` prints its version banner to stdout ahead of the module's output.
      const lastLine = (args: string[]) => run(temp_dir, args).split("\n").at(-1);

      expect(lastLine(["test", "--define", 'BVAL:"cli"', "./a.test.js"])).toBe("cli");
      expect(newCacheCount()).toBe(1);

      expect(lastLine(["test", "./a.test.js"])).toBe("undefined");
      expect(newCacheCount()).toBe(0);
      expect(run(temp_dir, ["a.js"])).toBe("undefined");
      expect(newCacheCount()).toBe(0);

      expect(lastLine(["test", "--define", 'BVAL:"cli"', "./a.test.js"])).toBe("cli");
      expect(newCacheCount()).toBe(0);
      expect(run(temp_dir, ["a.js"])).toBe("undefined");
      expect(newCacheCount()).toBe(0);
    });

    test("--drop invalidates cache", () => {
      writeFileSync(
        join(temp_dir, "a.js"),
        `console.log("logged");\nprocess.stdout.write("written\\n");` + "\n//" + filler,
      );

      expect(run(temp_dir, ["a.js"])).toBe("logged\nwritten");
      expect(newCacheCount()).toBe(1);

      expect(run(temp_dir, ["--drop=console", "a.js"])).toBe("written");
      expect(newCacheCount()).toBe(0);

      expect(run(temp_dir, ["--drop=console", "a.js"])).toBe("written");
      expect(newCacheCount()).toBe(0);

      expect(run(temp_dir, ["a.js"])).toBe("logged\nwritten");
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
  // Serialized module record layout (ModuleInfoStringTable + body, see
  // `ModuleInfoDeserialized::serialize` in src/js_printer/lib.rs):
  //   table: [offset_width u8][0;3][count u32][(count+1) offsets][pad to even][bytes]
  //   body:  [flags u8][id_width u8][0;2][n_requested u32][n_records u32]
  //          [n_records tag bytes][n_requested tag bytes][string ids @ id_width ...]
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

    const readUint = (at: number, width: number) =>
      width === 1 ? data.readUInt8(at) : width === 2 ? data.readUInt16LE(at) : data.readUInt32LE(at);
    const offsetWidth = data.readUInt8(esmOff);
    const count = data.readUInt32LE(esmOff + 4);
    const offsetsAt = esmOff + 8;
    const total = readUint(offsetsAt + count * offsetWidth, offsetWidth);
    const offsetsLen = (count + 1) * offsetWidth;
    const bodyAt = offsetsAt + offsetsLen + (offsetsLen % 2) + total;
    const nRequested = data.readUInt32LE(bodyAt + 4);
    const nRecords = data.readUInt32LE(bodyAt + 8);
    const idsAt = bodyAt + 12 + nRecords + nRequested;
    const end = esmOff + esmLen;
    if (nRecords === 0 || idsAt >= end) return false;

    // Point every string id in the body past the table (and past the two
    // sentinels count / count+1): all-ones at whatever width the ids use.
    data.fill(0xff, idsAt, end);
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

test("rejects a cached entry whose sourcemap section header is corrupt", () => {
  // A cache hit hands the stored sourcemap section to SavedSourceMap, which
  // reads it as an InternalSourceMap blob. Stack remapping then walks the
  // blob's SyncEntry array and window streams by the offsets in its header.
  // A damaged header (for example an inflated sync_count) must be rejected so
  // the entry regenerates, not read out of bounds.
  //
  // Cache entry layout (src/jsc/RuntimeTranspilerCache.rs, Metadata::encode):
  //   0: cache_version u32, 4: module_type u8, 5: output_encoding u8,
  //   then twelve u64 fields; sourcemap_byte_offset @ 54,
  //   sourcemap_byte_length @ 62, sourcemap_hash @ 70.
  // InternalSourceMap header (src/sourcemap/InternalSourceMap.rs):
  //   0: total_len u64, 8: mapping_count u64, 16: input_line_count u64,
  //   24: sync_count u32, 28: stream_offset u32.
  const SOURCEMAP_BYTE_OFFSET_AT = 54;
  const SOURCEMAP_BYTE_LENGTH_AT = 62;

  function corruptSourceMapHeader(file: string): boolean {
    const data = readFileSync(file);
    if (data.length < 102) return false;
    const smOff = Number(data.readBigUInt64LE(SOURCEMAP_BYTE_OFFSET_AT));
    const smLen = Number(data.readBigUInt64LE(SOURCEMAP_BYTE_LENGTH_AT));
    if (smLen < 32 || smOff + smLen > data.length) return false;
    // Inflate sync_count so the SyncEntry array claims far more entries than
    // the section holds.
    data.writeUInt32LE(0x0fffffff, smOff + 24);
    writeFileSync(file, data);
    return true;
  }

  // A module large enough for the cache (>= 4 KiB) that throws. Reading the
  // error's stack forces the runtime to remap the captured frame through the
  // cached sourcemap while the process still exits 0.
  const line = `// ${Buffer.alloc(120, "x").toString()}\n`;
  const filler = Buffer.alloc(120 * line.length, line).toString();
  writeFileSync(
    join(temp_dir, "boom.ts"),
    `${filler}
function boom(): number {
  throw new Error("boom");
}
try {
  boom();
} catch (e) {
  void (e as Error).stack;
}
console.log("OK");
`,
  );

  const run = () => Bun.spawnSync({ cmd: [bunExe(), "./boom.ts"], cwd: temp_dir, env });

  // First run writes the cache entry. Second run serves the intact entry and
  // still remaps the stack and prints the marker.
  const first = run();
  expect(first.stdout.toString()).toContain("OK");
  expect(existsSync(cache_dir)).toBeTrue();
  expect(first.exitCode).toBe(0);

  const second = run();
  expect(second.stdout.toString()).toContain("OK");
  expect(second.exitCode).toBe(0);

  // Corrupt the stored sourcemap header.
  let corrupted = 0;
  for (const name of readdirSync(cache_dir)) {
    if (name.endsWith(".pile") && corruptSourceMapHeader(join(cache_dir, name))) corrupted++;
  }
  expect(corrupted).toBeGreaterThanOrEqual(1);

  // Third run: the corrupt section is rejected, the entry regenerates, and the
  // module runs clean with a normal (non-signal) exit.
  const third = run();
  expect(third.stdout.toString()).toContain("OK");
  expect(third.signalCode).toBeUndefined();
  expect(third.exitCode).toBe(0);
});

describe.concurrent("`bun test` and `bun run`", () => {
  const padding = Buffer.alloc("// padding\n".length * 400, "// padding\n").toString();
  const commands = {
    "run": ["run", "load.js"],
    "test": ["test", "./load.test.js"],
    "test --globals=vitest": ["test", "--globals=vitest", "./load.test.js"],
  };
  type Mode = keyof typeof commands;

  async function load(cwd: string, cache: string, mode: Mode, flags: string[] = []) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...commands[mode].slice(0, -1), ...flags, commands[mode].at(-1)!],
      env: { ...env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim().split("\n").at(-1)).toBe("loaded");
    if (mode !== "run") expect(stderr).toContain(" 1 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  }

  /** The entries of a cache directory, by the N of the `"entry:N:"` in the source of each. */
  function readEntries(cache: string) {
    const entries = new Map<number, { bytes: Buffer; key: string; output: Buffer; written: bigint }>();
    for (const name of readdirSync(cache)) {
      const bytes = readFileSync(join(cache, name));
      const id = /entry:(\d+):/.exec(bytes.toString("latin1"));
      if (!id) continue;
      entries.set(Number(id[1]), {
        bytes,
        // 0: cache_version u32, 4: module_type u8, 5: output_encoding u8, 6: features_hash u64
        key: bytes.subarray(6, 14).toString("hex"),
        output: Buffer.concat([bytes.subarray(0, 6), bytes.subarray(14)]),
        written: statSync(join(cache, name), { bigint: true }).mtimeNs,
      });
    }
    return entries;
  }

  const loader = (files: string[], how: "import" | "require") => ({
    "load.js": `
      for (const file of ${JSON.stringify(files)}) {
        try {
          ${how === "import" ? "await import" : "require"}("./" + file);
        } catch {}
      }
      console.log("loaded");
    `,
    "load.test.js": `
      import { test } from "bun:test";
      import "./load.js";
      test("loaded", () => {});
    `,
  });

  test("share the entry of a file that uses nothing of `bun test`", async () => {
    const files = Array.from({ length: 6 }, (_, i) => `module${i}.ts`);
    using dir = tempDir("transpiler-cache-shared", {
      ...Object.fromEntries(files.map((file, i) => [file, `export const id: string = "entry:${i}:";\n${padding}`])),
      ...loader(files, "import"),
    });
    // How many entries each run of a sequence wrote, all runs of it with one cache.
    const written = await Promise.all(
      (
        [
          ["run", "test", "run", "test"],
          ["test", "test", "run", "run"],
          ["test --globals=vitest", "run", "test", "test --globals=vitest"],
        ] as const
      ).map(async (sequence, i) => {
        const cache = join(String(dir), `.cache-${i}`);
        let before: ReturnType<typeof readEntries> = new Map();
        const counts: number[] = [];
        for (const mode of sequence) {
          await load(String(dir), cache, mode);
          const after = readEntries(cache);
          counts.push([...after].filter(([id, entry]) => before.get(id)?.written !== entry.written).length);
          before = after;
        }
        return counts;
      }),
    );
    expect(written).toEqual([
      [6, 0, 0, 0],
      [6, 0, 0, 0],
      [6, 0, 0, 0],
    ]);
  }, 60_000);

  // Whether what the file is transpiled to may depend on `bun test`.
  const globals = [
    ...["test", "it", "describe", "expect", "expectTypeOf", "beforeAll", "beforeEach", "afterEach", "afterAll", "jest"],
    ...["vi", "xit", "xtest", "xdescribe", "onTestFinished", "suite", "vitest", "onTestFailed", "assertType"],
  ];
  const sources: Record<string, [extension: string, source: string, usesTestApi: boolean]> = {
    "nothing, js": ["js", `import { a } from "./dep.js"; export function f(x) { return a(x); }`, false],
    "nothing, ts": ["ts", `import { a } from "./dep.js"; export function f(x: number) { return a(x); }`, false],
    "nothing, cjs": ["cjs", `module.exports = function f(x) { return x; };`, false],
    "nothing, jsx": ["jsx", `export function f(x) { return <div>{x}</div>; }`, false],

    ...Object.fromEntries(
      globals.map(name => [`global ${name}`, ["js", `export function f() { return ${name}; }`, true]]),
    ),
    "typeof": ["js", `export const t = () => typeof describe;`, true],
    "in a nested function": ["js", `export function f() { return function g() { return () => describe; }; }`, true],
    "in a method": ["js", `export class A { m() { return describe; } }`, true],
    "in a static block": ["js", `export class A { static { if (A.x) void expect; } }`, true],
    "in a field": ["js", `export class A { x = () => expect; }`, true],
    "in a scope with eval": ["js", `export function f(s) { eval(s); return describe; }`, true],
    "declare const": ["ts", `declare const describe: any; export function f() { return describe; }`, true],
    "declare function": ["ts", `declare function describe(): void; export function f() { return describe; }`, true],
    "declare global": ["ts", `declare global { var describe: any; } export function f() { return describe; }`, true],
    "beside a shadowing parameter": [
      "js",
      `export function f(describe) { return describe; } export function g() { return describe; }`,
      true,
    ],
    "shorthand property": ["js", `export function f() { return { expect }; }`, true],
    "assignment": ["cjs", `module.exports = function f() { describe = 1; };`, true],
    "delete": ["cjs", `module.exports = function f() { return delete describe; };`, true],
    "with": ["cjs", `module.exports = function f(o) { with (o) { return describe; } };`, true],
    "in CommonJS": ["cjs", `module.exports = function f() { return describe; };`, true],
    "decorator": ["ts", `export function f() { @describe class A {} return A; }`, true],
    "template tag": ["js", "export function f() { return test`x`; }", true],
    "optional call": ["js", `export function f() { return describe?.(); }`, true],
    "default of a parameter": ["js", `export function f(a = expect) { return a; }`, true],
    "JSX member": ["jsx", `export function f() { return <vi.mock />; }`, true],
    "after return": ["js", `export function f() { return 1; describe(); }`, true],
    "if (typeof window)": ["js", `export function f() { if (typeof window !== "undefined") describe(); }`, true],
    "if NODE_ENV is test": ["js", `export function f() { if (process.env.NODE_ENV === "test") describe(); }`, true],
    "if NODE_ENV is not test": ["js", `export function f() { if (process.env.NODE_ENV !== "test") describe(); }`, true],

    "only in eval": ["js", `export function f() { return eval("describe"); }`, false],
    "type positions": [
      "ts",
      `export type T = typeof describe; export let x: ReturnType<typeof expect> | undefined; export function f(a: typeof vi) { return a as typeof jest; }`,
      false,
    ],
    "shadowing parameter": ["js", `export function f(describe) { return describe; }`, false],
    "shadowing catch": ["js", `export function f() { try {} catch (expect) { return expect; } }`, false],
    "shadowing local": ["js", `export function f() { let it = 1; return it; }`, false],
    "globalThis.describe": ["js", `export function f() { return globalThis.describe; }`, false],
    "window.describe": ["js", `export function f() { return window.describe; }`, false],
    "property, key, string, label": [
      "js",
      `export function f(o) { test: for (;;) break test; return [o.expect, { describe: 1 }, "vi", o?.jest, class { it() {} }]; }`,
      false,
    ],
    "var after the use": ["js", `export function f() { return describe; } var describe = 1;`, false],
    "var in a block": ["js", `export function f() { return describe; } { var describe = 1; }`, false],
    "function after the use": ["js", `export function f() { return describe; } function describe() {}`, false],
    "function in a block": [
      "cjs",
      `module.exports = function f() { return describe; }; { function describe() {} }`,
      false,
    ],
    "let after the use": ["js", `export function f() { return describe; } let describe = 1;`, false],
    "class after the use": ["js", `export function f() { return describe; } class describe {}`, false],
    "import of the name": [
      "js",
      `import { describe } from "./dep.js"; export function f() { return describe; }`,
      false,
    ],
    "namespace import of the name": [
      "js",
      `import * as vi from "./dep.js"; export function f() { return vi.mock("./dep.js"); }`,
      false,
    ],
    "member of a namespace": [
      "ts",
      `export namespace N { export const describe = 1; export const y = () => describe; }`,
      false,
    ],
    "member of an enum": ["ts", `export enum E { test = 1, y = test }`, false],
    "import equals": ["ts", `import describe = require("./dep.js"); export function f() { return describe; }`, false],
    "JSX tag": ["jsx", `export function f() { return <describe />; }`, false],
    "if (false)": ["js", `export function f() { if (false) { describe(); } }`, true],
    "false &&": ["js", `export function f() { return false && describe(); }`, true],
    "vi.mock(import()) in dead code": ["js", `if (false) vi.mock(import("./dep.js"), () => ({}));`, true],
    "NODE_ENV": ["js", `export function f() { return process.env.NODE_ENV === "test" ? 1 : 2; }`, false],
    "import.meta.env": [
      "js",
      `export function f() { return [import.meta.env.MODE, import.meta.env.NODE_ENV]; }`,
      false,
    ],

    "import vitest": ["js", `import { vi } from "vitest"; export function f() { return vi; }`, true],
    "import @jest/globals": ["js", `import { jest } from "@jest/globals"; export function f() { return jest; }`, true],
    "import bun:test": ["js", `import { jest } from "bun:test"; export function f() { return jest; }`, true],
    "import of no name": ["js", `import "vitest"; export function f() {}`, true],
    "import {}": ["js", `import {} from "vitest"; export function f() {}`, true],
    "import default": ["js", `import v from "vitest"; export function f() { return v; }`, true],
    "import *": ["js", `import * as V from "vitest"; export function f() { return V.vi.mock("./dep.js"); }`, true],
    "import that is not used": ["ts", `import { vi } from "vitest"; export function f() {}`, true],
    "export *": ["js", `export * from "vitest"; export function f() {}`, true],
    "export * as": ["js", `export * as v from "vitest"; export function f() {}`, true],
    "export from": ["js", `export { vi } from "@jest/globals"; export function f() {}`, true],
    "require()": ["cjs", `module.exports = function f() { return require("vitest"); };`, true],
    "require() in ESM": ["js", `export function f() { return require("@jest/globals"); }`, true],
    "require() of a template": ["cjs", "module.exports = function f() { return require(`vitest`); };", true],
    "require() of a conditional": [
      "cjs",
      `module.exports = function f(v) { return require(v ? "vitest" : "./dep.js"); };`,
      true,
    ],
    "require.resolve()": ["cjs", `module.exports = function f() { return require.resolve("vitest"); };`, true],
    "import() of bun:test": ["js", `export function f() { return import("bun:test"); }`, true],
    "import() of vitest": ["js", `export function f() { return import("vitest"); }`, true],

    "import type": ["ts", `import type { Mock } from "vitest"; export function f(a: Mock) { return a; }`, false],
    "import { type }": ["ts", `import { type Mock } from "vitest"; export function f(a: Mock) { return a; }`, false],
    "export type": ["ts", `export type { Mock } from "vitest"; export function f() {}`, false],
    "require() of no literal": ["cjs", `module.exports = function f(v) { return require(v + "vitest"); };`, false],
    "import() of no literal": ["js", `export function f(v) { return import(v + "vitest"); }`, false],
    "import.meta.resolve()": ["js", `export function f() { return import.meta.resolve("vitest"); }`, false],
    "require() in dead code": ["cjs", `module.exports = function f() { if (false) return require("vitest"); };`, false],
    "a path in the package": ["js", `export function f() { return import("vitest/config"); }`, false],
    "macro that is not called": [
      "ts",
      `import { m } from "./macro.ts" with { type: "macro" }; export function f() {}`,
      false,
    ],

    "vi.mock(), global": [
      "js",
      `import { a } from "./dep.js"; vi.mock("./dep.js", () => ({ a() {} })); export function f() { return a(); }`,
      true,
    ],
    "vi.mock(), imported": [
      "js",
      `import { a } from "./dep.js"; import { vi } from "vitest"; vi.mock("./dep.js", () => ({ a() {} })); export function f() { return a(); }`,
      true,
    ],
    "vi.mock(), imported as": [
      "js",
      `import { a } from "./dep.js"; import { vi as v } from "vitest"; v.mock("./dep.js", () => ({ a() {} })); export function f() { return a(); }`,
      true,
    ],
    "jest.mock() of bun:test": [
      "js",
      `import { a } from "./dep.js"; import { jest } from "bun:test"; jest.mock("./dep.js", () => ({ a() {} })); export function f() { return a(); }`,
      true,
    ],
    "jest.mock() of @jest/globals": [
      "js",
      `import { a } from "./dep.js"; import { jest } from "@jest/globals"; jest.mock("./dep.js", () => ({ a() {} })); export function f() { return a(); }`,
      true,
    ],
    "vi.hoisted()": [
      "js",
      `import { a } from "./dep.js"; const h = vi.hoisted(() => 1); export function f() { return a(h); }`,
      true,
    ],
    "vi.doMock(import()), global": ["js", `export function f() { vi.doMock(import("./dep.js"), () => ({})); }`, true],
    "vi.doMock(import()), imported": [
      "js",
      `import { vi } from "vitest"; export function f() { vi.doMock(import("./dep.js"), () => ({})); }`,
      true,
    ],
    "vi.mock() that is pure": ["js", `/* @__PURE__ */ vi.mock("./dep.js");`, true],
    "vi.mock(import()) that is pure": ["js", `/* @__PURE__ */ vi.mock(import("./dep.js"));`, true],
    "mock.module()": [
      "js",
      `import { a } from "./dep.js"; import { mock } from "bun:test"; mock.module("./dep.js", () => ({ a() {} })); export function f() { return a(); }`,
      true,
    ],
    "a vi of its own": [
      "js",
      `import { a } from "./dep.js"; const vi = { mock() {}, hoisted() {}, doMock() {} }; vi.mock("./dep.js"); vi.hoisted(() => 1); vi.doMock(import("./dep.js")); export function f() { return a(); }`,
      false,
    ],
  };

  test.each(["import", "require"] as const)(
    "keep apart the entries of a file that does, loaded by %s()",
    async how => {
      const names = Object.keys(sources);
      const files = names.map((name, i) => `source${i}.${sources[name][0]}`);
      using dir = tempDir("transpiler-cache-apart", {
        ...Object.fromEntries(
          names.map((name, i) => [files[i], `globalThis.id = "entry:${i}:";\n${sources[name][1]}\n${padding}`]),
        ),
        ...loader(files, how),
        "dep.js": `export function a() {} export const describe = 1;`,
        "macro.ts": `export function m() { return 1; }`,
        "node_modules/vitest/package.json": `{ "name": "vitest", "version": "1.0.0", "main": "index.js" }`,
        "node_modules/vitest/index.js": `exports.vi = exports.default = "not bun's";`,
        "node_modules/@jest/globals/package.json": `{ "name": "@jest/globals", "version": "1.0.0", "main": "index.js" }`,
        "node_modules/@jest/globals/index.js": `exports.jest = exports.vi = "not bun's";`,
      });
      const modes = Object.keys(commands) as Mode[];

      // Each mode after each other, every pair with a cache of its own.
      const pairs = await Promise.all(
        modes
          .flatMap(first => modes.filter(second => second !== first).map(second => [first, second] as const))
          .map(async ([first, second], i) => {
            const cache = join(String(dir), `.cache-${i}`);
            await load(String(dir), cache, first);
            const afterFirst = readEntries(cache);
            await load(String(dir), cache, second);
            return { first, second, afterFirst, afterSecond: readEntries(cache) };
          }),
      );
      // What each mode transpiles the files to, with nothing in the cache.
      const fresh = Object.fromEntries(pairs.map(pair => [pair.first, pair.afterFirst])) as Record<
        Mode,
        ReturnType<typeof readEntries>
      >;
      for (const mode of modes) expect([mode, fresh[mode].size]).toEqual([mode, names.length]);

      // A file that uses nothing of `bun test` has the key of "nothing" with its extension, in every mode.
      const keyOfNothing = (i: number) => fresh.run.get(names.indexOf(`nothing, ${sources[names[i]][0]}`))!.key;
      const expected = names.filter(name => sources[name][2]);
      for (const mode of modes) {
        expect([mode, names.filter((_, i) => fresh[mode].get(i)!.key !== keyOfNothing(i))]).toEqual([mode, expected]);
      }
      // Any other has one key for each mode.
      expect(names.filter((_, i) => new Set(modes.map(mode => fresh[mode].get(i)!.key)).size === modes.length)).toEqual(
        expected,
      );
      // And only such a file is transpiled to something else in one of them.
      const differs = names.filter((_, i) =>
        modes.some(mode => !fresh[mode].get(i)!.output.equals(fresh.run.get(i)!.output)),
      );
      expect(differs.filter(name => !sources[name][2])).toEqual([]);
      expect(differs).toContain("global describe");
      expect(differs).toContain("global suite");
      expect(differs).toContain("import vitest");
      expect(differs).toContain("vi.doMock(import()), imported");
      expect(differs).toContain("vi.mock(import()) that is pure");

      for (const { first, second, afterFirst, afterSecond } of pairs) {
        const differ = (entries: typeof afterFirst, mode: Mode) =>
          names.filter((_, i) => !entries.get(i)?.bytes.equals(fresh[mode].get(i)!.bytes));
        // What the cache holds after a run is what that run would have made with nothing in it,
        expect([first, second, differ(afterFirst, first), differ(afterSecond, second)]).toEqual([
          first,
          second,
          [],
          [],
        ]);
        // and the second run wrote none of what the two share.
        expect([
          first,
          second,
          names.filter((_, i) => afterSecond.get(i)!.written !== afterFirst.get(i)!.written),
        ]).toEqual([first, second, expected]);
      }
    },
    120_000,
  );

  test.each([
    ["vi.mock=replaced", `vi.mock("./dep.js", () => ({ a() {} }));`],
    ["vi.hoisted=replaced", `const hoisted = vi.hoisted(() => 1);`],
    ["vi=replaced", `vi.mock("./dep.js", () => ({ a() {} }));`],
    ["named=describe", `export const g = () => named;`],
    ["named.dot=expect", `export const g = () => named.dot;`],
    ["named=vi", `export const g = () => named.doMock(import("./dep.js"), () => ({}));`],
  ])(
    "keep apart the entries of a file that uses it only without, or only with, --define %s",
    async (define, statement) => {
      using dir = tempDir("transpiler-cache-define", {
        "source.js": `globalThis.id = "entry:0:";\nimport { a } from "./dep.js";\n${statement}\nexport function f() { return a(); }\n${padding}`,
        "nothing.js": `globalThis.id = "entry:1:";\nimport { a } from "./dep.js";\nexport function f() { return a(); }\n${padding}`,
        "dep.js": `export function a() {}`,
        ...loader(["source.js", "nothing.js"], "import"),
      });
      const flags = ["--define", define];
      const [runFirst, testFirst] = await Promise.all(
        (
          [
            ["run", "test"],
            ["test", "run"],
          ] as const
        ).map(async ([first, second], i) => {
          const cache = join(String(dir), `.cache-${i}`);
          await load(String(dir), cache, first, flags);
          const afterFirst = readEntries(cache);
          await load(String(dir), cache, second, flags);
          return { afterFirst, afterSecond: readEntries(cache) };
        }),
      );
      const fresh = { run: runFirst.afterFirst, test: testFirst.afterFirst };
      expect({
        differs: !fresh.run.get(0)!.output.equals(fresh.test.get(0)!.output),
        keys: new Set([fresh.run.get(0)!.key, fresh.test.get(0)!.key, fresh.run.get(1)!.key, fresh.test.get(1)!.key])
          .size,
        testAfterRun: runFirst.afterSecond.get(0)!.bytes.equals(fresh.test.get(0)!.bytes),
        runAfterTest: testFirst.afterSecond.get(0)!.bytes.equals(fresh.run.get(0)!.bytes),
      }).toEqual({ differs: true, keys: 3, testAfterRun: true, runAfterTest: true });
    },
    60_000,
  );

  test("an entry of another version is replaced", async () => {
    using dir = tempDir("transpiler-cache-version", {
      "module.ts": `export const id: string = "entry:0:";\n${padding}`,
      ...loader(["module.ts"], "import"),
    });
    const cache = join(String(dir), ".cache");
    await load(String(dir), cache, "run");
    const [name] = readdirSync(cache);
    const entry = readFileSync(join(cache, name));
    const older = Buffer.from(entry);
    older.writeUInt32LE(entry.readUInt32LE(0) - 1, 0);
    writeFileSync(join(cache, name), older);
    for (const mode of ["test", "run"] as const) {
      await load(String(dir), cache, mode);
      expect(readdirSync(cache)).toEqual([name]);
      expect(readFileSync(join(cache, name)).equals(entry)).toBe(true);
    }
  }, 60_000);
});
