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
import { bunEnv, bunExe, bunRun, isWindows, tmpdirSync } from "harness";
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

// The runtime transpiler cache stores a serialized ES module record
// ("esm_record") alongside the transpiled output of every ES module.
//
// Cache entry layout (src/jsc/RuntimeTranspilerCache.rs, Metadata::encode):
//   0: cache_version u32, 4: module_type u8, 5: output_encoding u8,
//   then twelve u64 fields; esm_record_byte_offset @ 78,
//   esm_record_byte_length @ 86, esm_record_hash @ 94. Payload follows @ 102.
// Serialized module record layout (ModuleInfoStringTable + body, see
// `ModuleInfoDeserialized::serialize` in src/js_printer/lib.rs):
//   table: [offset_width u8][0;3][count u32][(count+1) offsets][pad to even][bytes]
//   each string in bytes: [encoding u8: 1 Latin-1, 0 UTF-16LE after pad to even]
//   body:  [flags u8][id_width u8][0;2][n_requested u32][n_records u32]
//          [n_records tag bytes][n_requested tag bytes][string ids @ id_width ...]
const ESM_RECORD_BYTE_OFFSET_AT = 78;
const ESM_RECORD_BYTE_LENGTH_AT = 86;
const ESM_RECORD_HASH_AT = 94;
const METADATA_SIZE = 102;

// src/js_printer/lib.rs RecordKind discriminants and the id count each kind
// writes before elisions (see `shape` in `serialize_body`).
const RECORD_KIND = {
  ImportInfoSingle: 0,
  ImportInfoSingleTypeScript: 1,
  ImportInfoNamespace: 2,
  ExportInfoIndirect: 3,
  ExportInfoLocal: 4,
  ExportInfoNamespace: 5,
  ExportInfoStar: 6,
  ImportInfoNamespaceDefer: 7,
} as const;
const RECORD_IDS = [3, 3, 3, 3, 2, 2, 1, 3] as const;
const RECORD_KIND_NAME = Object.fromEntries(Object.entries(RECORD_KIND).map(([name, kind]) => [kind, name]));

function readModuleRecord(file: string): { kind: string; name: string }[] | null {
  const data = readFileSync(file);
  if (data.length < METADATA_SIZE) return null;
  const esmOff = Number(data.readBigUInt64LE(ESM_RECORD_BYTE_OFFSET_AT));
  const esmLen = Number(data.readBigUInt64LE(ESM_RECORD_BYTE_LENGTH_AT));
  if (esmLen === 0) return null;

  const readUint = (at: number, width: number) =>
    width === 1 ? data.readUInt8(at) : width === 2 ? data.readUInt16LE(at) : data.readUInt32LE(at);

  // String table.
  const offsetWidth = data.readUInt8(esmOff);
  const count = data.readUInt32LE(esmOff + 4);
  const offsetsAt = esmOff + 8;
  const offsetsLen = (count + 1) * offsetWidth;
  const bytesAt = offsetsAt + offsetsLen + (offsetsLen % 2);
  const string = (id: number) => {
    if (id === count) return "*namespace";
    if (id === count + 1) return "*default";
    const start = readUint(offsetsAt + id * offsetWidth, offsetWidth);
    const end = readUint(offsetsAt + (id + 1) * offsetWidth, offsetWidth);
    let at = start + 1; // encoding byte
    if (data.readUInt8(bytesAt + start) === 1) return data.toString("latin1", bytesAt + at, bytesAt + end);
    if (at % 2 !== 0) at += 1; // UTF-16 bodies are 2-aligned within the blob
    return data.toString("utf16le", bytesAt + at, bytesAt + end);
  };
  const total = readUint(offsetsAt + count * offsetWidth, offsetWidth);

  // Body.
  const bodyAt = bytesAt + total;
  const idWidth = data.readUInt8(bodyAt + 1);
  const nRequested = data.readUInt32LE(bodyAt + 4);
  const nRecords = data.readUInt32LE(bodyAt + 8);
  const recordTagsAt = bodyAt + 12;
  const requestedTagsAt = recordTagsAt + nRecords;
  let idsAt = requestedTagsAt + nRequested;
  const nextId = () => {
    const v = readUint(idsAt, idWidth);
    idsAt += idWidth;
    return v;
  };

  // Skip the requested-module ids: a specifier each, plus a host-defined type
  // id when the tag's fetch-kind (bits 1..) is 4.
  for (let i = 0; i < nRequested; i++) {
    nextId();
    if (data.readUInt8(requestedTagsAt + i) >> 1 === 4) nextId();
  }

  // The first id of every record names what it declares: the module specifier
  // for imports and star exports, the export name otherwise. Namespace imports
  // elide slot 1, `same-name` single imports elide slot 2, and a fetch-kind of
  // 4 appends a host-defined type id.
  const records: { kind: string; name: string }[] = [];
  for (let i = 0; i < nRecords; i++) {
    const tag = data.readUInt8(recordTagsAt + i);
    const kind = tag & 7;
    const fetchKind = (tag >> 3) & 7;
    const sameName = (tag >> 6) & 1;
    let written = RECORD_IDS[kind];
    if (kind === RECORD_KIND.ImportInfoNamespace || kind === RECORD_KIND.ImportInfoNamespaceDefer) written -= 1;
    if ((kind === RECORD_KIND.ImportInfoSingle || kind === RECORD_KIND.ImportInfoSingleTypeScript) && sameName)
      written -= 1;
    const name = string(nextId());
    for (let j = 1; j < written; j++) nextId();
    if (fetchKind === 4) nextId();
    records.push({ kind: RECORD_KIND_NAME[kind], name });
  }
  return records;
}

test("module records list local exports last, in export name order", async () => {
  // JSC sorts the export entries by name every time it builds a module
  // namespace object, and its sort degrades badly when the entries arrive in
  // source order (see ModuleInfo::finalize in src/js_printer/lib.rs). The
  // printer therefore canonicalizes the record: everything else stays in
  // source order, local exports follow sorted by name.
  const filler = ("// " + "x".repeat(120) + "\n").repeat(40);
  writeFileSync(
    join(temp_dir, "lib.js"),
    `import { join } from "node:path";
export const zeta = 1;
export { join as pathJoin };
export function alpha() {}
export { basename as renamedBasename } from "node:path";
export let mid = 2;
export default 3;
${filler}`,
  );
  writeFileSync(
    join(temp_dir, "main.js"),
    `import * as lib from "./lib.js";\nconsole.log(Object.keys(lib).join(","));`,
  );

  expect(await bunRun(join(temp_dir, "main.js"), env)).toSpawn("alpha,default,mid,pathJoin,renamedBasename,zeta");

  const records = readdirSync(cache_dir)
    .map(name => readModuleRecord(join(cache_dir, name)))
    .filter(records => records !== null);
  expect(records).toEqual([
    [
      { kind: "ImportInfoSingle", name: "node:path" },
      { kind: "ExportInfoIndirect", name: "pathJoin" },
      { kind: "ExportInfoIndirect", name: "renamedBasename" },
      { kind: "ExportInfoLocal", name: "alpha" },
      { kind: "ExportInfoLocal", name: "default" },
      { kind: "ExportInfoLocal", name: "mid" },
      { kind: "ExportInfoLocal", name: "zeta" },
    ],
  ]);
});

test("rejects cached module records containing out-of-range string indices", () => {
  // The string indices inside the record are used to index an identifier
  // table when the record is converted back into a JSC module record, so any
  // index beyond the table length (other than the reserved *-default /
  // *-namespace sentinels near u32::MAX) must be rejected.
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
