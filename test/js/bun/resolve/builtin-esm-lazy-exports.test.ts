import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Builtins implemented in src/js are exposed to ESM importers by turning their CommonJS exports object into a
// synthetic module. Some of those objects define accessors so that the expensive part of the module is only
// loaded by whoever touches it. node:fs is the clearest case: each of its stream classes is a getter that
// require()s internal/fs/streams (and with it the node:stream stack) and then replaces itself with a data
// property, so "is it still an accessor on the exports object" is a direct readout of whether importing the
// module as ESM ran the getter.
//
// Every scenario gets its own process because a binding can only be materialized once.

const STREAMS = ["ReadStream", "WriteStream", "FileReadStream", "FileWriteStream", "Utf8Stream"] as const;
type Kind = "accessor" | "value";

/** Expected descriptor kinds: everything is still an accessor except the names listed as materialized. */
function kinds(...materialized: (typeof STREAMS)[number][]): Record<string, Kind> {
  return Object.fromEntries(STREAMS.map(name => [name, materialized.includes(name) ? "value" : "accessor"]));
}

// `import fs from "node:fs"` here is itself an import of the module under test; the default export is the
// exports object, which is also the thing whose property descriptors we inspect.
const helper = `
  import fs from "node:fs";
  export const STREAMS = ${JSON.stringify(STREAMS)};
  export function kinds() {
    return Object.fromEntries(
      STREAMS.map(name => [name, typeof Object.getOwnPropertyDescriptor(fs, name).get === "function" ? "accessor" : "value"]),
    );
  }
  export function print(result) {
    console.log(JSON.stringify(result));
  }
  export { fs };
`;

// The "bun" module is generated natively from the Bun object (generateNativeModule_BunObject). Most Bun.* properties
// are PropertyCallback entries of its static table that construct their value (a class, the shell, the default
// SQL/S3/Redis clients, ...) the first time they are read, at which point they become own properties of the object.
// bun:jsc's describe() dumps the object's Structure, i.e. exactly the set of properties that have been constructed,
// which is the readout used here. WATCHED is a sample of them plus `write`, the plain function the entries below import.
//
// Note that a literal `import ... from "bun"` (and `import("bun")` / `require("bun")`) is rewritten by the
// transpiler into a read of globalThis.Bun and never loads the module; the module is what `export ... from "bun"`
// and a non-literal import() specifier go through.
const WATCHED = ["$", "CryptoHasher", "Glob", "S3Client", "SQL", "TOML", "Transpiler", "secrets", "write"] as const;

const bunHelper = `
  import { describe } from "bun:jsc";
  const WATCHED = ${JSON.stringify(WATCHED)};
  /** The WATCHED names that are own properties of the Bun object by now, i.e. whose value has been constructed. */
  export function constructed() {
    const properties = /\\{([^}]*)\\}/.exec(describe(Bun))[1];
    const names = properties.split(",").map(entry => entry.trim().split(":")[0]);
    return WATCHED.filter(name => names.includes(name));
  }
  export function print(result) {
    console.log(JSON.stringify(result));
  }
  // import(specifier) with this really loads the module; a literal (or a const the transpiler can inline) would be
  // rewritten to globalThis.Bun instead.
  export const specifier = "bun";
`;

const bunReexport = `
  export * from "bun";
  export { default as BunObject, Glob as RenamedGlob } from "bun";
`;

async function run(files: Record<string, string>, args: string[] = ["entry.mjs"], env: Record<string, string> = {}) {
  using dir = tempDir("builtin-esm-lazy-exports", { "helper.mjs": helper, "bun-helper.mjs": bunHelper, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function runEntry(entry: string, extraFiles: Record<string, string> = {}, env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await run({ ...extraFiles, "entry.mjs": entry }, undefined, env);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

test.concurrent("importing the module does not run its accessors", async () => {
  const result = await runEntry(`
    import fs, { readFileSync } from "node:fs";
    import { kinds, print } from "./helper.mjs";
    const ns = await import("node:fs");
    print({ defaultIsExportsObject: ns.default === fs, readFileSync: typeof readFileSync, kinds: kinds() });
  `);
  expect(result).toEqual({ defaultIsExportsObject: true, readFileSync: "function", kinds: kinds() });
});

test.concurrent("a named import materializes exactly the binding it links", async () => {
  const result = await runEntry(`
    import { ReadStream } from "node:fs";
    import { fs, kinds, print } from "./helper.mjs";
    print({ kinds: kinds(), isTheClass: typeof ReadStream === "function" && ReadStream === fs.ReadStream });
  `);
  expect(result).toEqual({ kinds: kinds("ReadStream"), isTheClass: true });
});

test.concurrent("a namespace export materializes when it is read, not on import or `in`", async () => {
  const result = await runEntry(`
    import * as ns from "node:fs";
    import { fs, kinds, print } from "./helper.mjs";
    const afterImport = kinds();
    // [[HasProperty]] does not read the binding. ([[GetOwnProperty]], e.g. hasOwnProperty or Object.keys, does.)
    const present = "WriteStream" in ns;
    const afterIn = kinds();
    const WriteStream = ns.WriteStream;
    print({
      afterImport,
      present,
      afterIn,
      afterRead: kinds(),
      isTheClass: typeof WriteStream === "function" && WriteStream === fs.WriteStream,
      secondReadIsStable: ns.WriteStream === WriteStream,
    });
  `);
  expect(result).toEqual({
    afterImport: kinds(),
    present: true,
    afterIn: kinds(),
    afterRead: kinds("WriteStream"),
    isTheClass: true,
    secondReadIsStable: true,
  });
});

test.concurrent("a deferred namespace (import defer) materializes on read as well", async () => {
  const result = await runEntry(`
    import defer * as ns from "node:fs";
    import { fs, kinds, print } from "./helper.mjs";
    const afterImport = kinds();
    const FileReadStream = ns.FileReadStream;
    print({
      afterImport,
      afterRead: kinds(),
      isTheClass: typeof FileReadStream === "function" && FileReadStream === fs.FileReadStream,
    });
  `);
  expect(result).toEqual({ afterImport: kinds(), afterRead: kinds("FileReadStream"), isTheClass: true });
});

test.concurrent("import() namespace: same export list as before, enumerating it materializes everything", async () => {
  const result = await runEntry(`
    import { STREAMS, fs, kinds, print } from "./helper.mjs";
    const exportsKeys = Object.keys(fs);
    const ns = await import("node:fs");
    const afterImport = kinds();
    const isTheClass = ns.Utf8Stream === fs.Utf8Stream && typeof ns.Utf8Stream === "function";
    const afterRead = kinds();
    const namespaceKeys = Object.keys(ns);
    print({
      afterImport,
      isTheClass,
      afterRead,
      afterKeys: kinds(),
      keysMatch: namespaceKeys.sort().join() === [...exportsKeys, "default"].sort().join(),
      allAreTheClasses: STREAMS.every(name => typeof ns[name] === "function" && ns[name] === fs[name]),
    });
  `);
  expect(result).toEqual({
    afterImport: kinds(),
    isTheClass: true,
    afterRead: kinds("Utf8Stream"),
    afterKeys: kinds(...STREAMS),
    keysMatch: true,
    allAreTheClasses: true,
  });
});

test.concurrent("re-exports bind through to the builtin's own binding", async () => {
  const result = await runEntry(
    `
      // Linking this import is what materializes FileWriteStream, through the export *.
      import { FileWriteStream } from "./reexport.mjs";
      import * as reexported from "./reexport.mjs";
      import { fs, kinds, print } from "./helper.mjs";
      const afterLink = kinds();
      const Renamed = reexported.Renamed;
      const afterRenamedRead = kinds();
      const viaStar = reexported.ReadStream;
      print({
        afterLink,
        afterRenamedRead,
        afterStarRead: kinds(),
        linked: typeof FileWriteStream === "function" && FileWriteStream === fs.FileWriteStream,
        renamed: typeof Renamed === "function" && Renamed === fs.FileReadStream,
        viaStar: typeof viaStar === "function" && viaStar === fs.ReadStream,
      });
    `,
    {
      "reexport.mjs": `
        export * from "node:fs";
        export { FileReadStream as Renamed } from "node:fs";
      `,
    },
  );
  expect(result).toEqual({
    afterLink: kinds("FileWriteStream"),
    afterRenamedRead: kinds("FileWriteStream", "FileReadStream"),
    afterStarRead: kinds("FileWriteStream", "FileReadStream", "ReadStream"),
    linked: true,
    renamed: true,
    viaStar: true,
  });
});

test.concurrent("accessors on other builtins bind to what require() returns", async () => {
  const result = await runEntry(`
    import assert, { AssertionError } from "node:assert";
    import * as timers from "node:timers";
    import * as stream from "node:stream";
    import { createRequire } from "node:module";
    import { print } from "./helper.mjs";
    const require = createRequire(import.meta.url);
    print({
      // node:assert's exports object is a function; AssertionError is an accessor defined on it.
      assertIsFunction: typeof assert === "function",
      assertionError: typeof AssertionError === "function" && AssertionError === require("node:assert").AssertionError,
      timersPromises: timers.promises === require("node:timers/promises"),
      streamPromises: stream.promises === require("node:stream/promises"),
    });
  `);
  expect(result).toEqual({ assertIsFunction: true, assertionError: true, timersPromises: true, streamPromises: true });
});

test.concurrent("spyOn and mock.module on an imported builtin", async () => {
  const { stderr, exitCode } = await run(
    {
      "lazy.test.ts": `
        import { expect, mock, spyOn, test } from "bun:test";
        import * as ns from "node:fs";
        import { fs, kinds } from "./helper.mjs";

        test("spyOn reads (and so materializes) the binding it wraps", () => {
          expect(kinds()).toEqual(${JSON.stringify(kinds())});
          spyOn(ns, "WriteStream");
          expect(kinds()).toEqual(${JSON.stringify(kinds("WriteStream"))});
          expect(ns.WriteStream).not.toBe(fs.WriteStream);
          mock.restore();
          expect(ns.WriteStream).toBe(fs.WriteStream);
        });

        test("mock.module writes into a binding nothing has read, without running its getter", () => {
          mock.module("node:fs", () => ({ ReadStream: "mocked" }));
          expect(ns.ReadStream).toBe("mocked");
          expect(kinds()).toEqual(${JSON.stringify(kinds("WriteStream"))});
        });
      `,
    },
    ["test", "lazy.test.ts"],
  );
  expect(stderr).toContain(" 2 pass");
  expect(stderr).toContain(" 0 fail");
  expect(exitCode).toBe(0);
});

test.concurrent('"bun": re-exports construct the properties that get bound, not the rest of the object', async () => {
  const result = await runEntry(
    `
      // Linking this import is what constructs Bun.write; nothing else is read.
      import { write } from "./reexport.mjs";
      import * as reexported from "./reexport.mjs";
      import { constructed, print } from "./bun-helper.mjs";
      const afterLink = constructed();
      const present = "SQL" in reexported;
      const afterIn = constructed();
      const RenamedGlob = reexported.RenamedGlob;
      const afterRenamedRead = constructed();
      const SQL = reexported.SQL;
      print({
        afterLink,
        present,
        afterIn,
        afterRenamedRead,
        afterStarRead: constructed(),
        write: write === Bun.write,
        renamedGlob: typeof RenamedGlob === "function" && RenamedGlob === Bun.Glob,
        sql: typeof SQL === "function" && SQL === Bun.SQL,
        secondReadIsStable: reexported.SQL === SQL,
        defaultIsBun: reexported.BunObject === Bun,
      });
    `,
    { "reexport.mjs": bunReexport },
  );
  expect(result).toEqual({
    afterLink: ["write"],
    present: true,
    afterIn: ["write"],
    afterRenamedRead: ["Glob", "write"],
    afterStarRead: ["Glob", "SQL", "write"],
    write: true,
    renamedGlob: true,
    sql: true,
    secondReadIsStable: true,
    defaultIsBun: true,
  });
});

test.concurrent('"bun": import() namespace has the same export list, and every export is the Bun.* value', async () => {
  const result = await runEntry(`
    import { constructed, print, specifier } from "./bun-helper.mjs";
    const ns = await import(specifier);
    const afterImport = constructed();
    // Neither [[OwnPropertyKeys]] of the namespace nor Object.keys of the Bun object reads any of the properties.
    const exportNames = Reflect.ownKeys(ns).filter(key => typeof key === "string").sort();
    const exportListMatches = exportNames.join() === [...Object.keys(Bun), "default"].sort().join();
    const afterListing = constructed();
    const TOML = ns.TOML;
    const afterRead = constructed();
    print({
      afterImport,
      exportListMatches,
      afterListing,
      toml: typeof TOML === "object" && TOML === Bun.TOML,
      afterRead,
      defaultIsBun: ns.default === Bun,
      everyExportIsTheProperty: Object.keys(Bun).every(name => ns[name] === Bun[name]),
      afterReadingEverything: constructed(),
    });
  `);
  expect(result).toEqual({
    afterImport: [],
    exportListMatches: true,
    afterListing: [],
    toml: true,
    afterRead: ["TOML"],
    defaultIsBun: true,
    everyExportIsTheProperty: true,
    afterReadingEverything: [...WATCHED],
  });
});

test.concurrent('"bun": a property whose getter throws only fails the binding that reads it', async () => {
  // Bun.redis builds the default client from REDIS_URL when it is first read, and throws on an invalid URL. That used
  // to fail loading the module (and so any module re-exporting from it) up front; now it is the problem of whoever
  // reads `redis`, and it is the same error a direct read of Bun.redis produces.
  const result = await runEntry(
    `
      import { write } from "./reexport.mjs";
      import * as reexported from "./reexport.mjs";
      import { print } from "./bun-helper.mjs";
      function message(read) {
        try {
          read();
          return "did not throw";
        } catch (error) {
          return error.message;
        }
      }
      const viaNamespace = message(() => reexported.redis);
      print({
        write: write === Bun.write,
        viaNamespace,
        sameErrorAsDirectRead: viaNamespace === message(() => Bun.redis),
        otherExportsStillWork: reexported.Glob === Bun.Glob,
      });
    `,
    { "reexport.mjs": bunReexport },
    { REDIS_URL: "http://[::1" },
  );
  expect(result).toEqual({
    write: true,
    viaNamespace: expect.stringContaining("URL"),
    sameErrorAsDirectRead: true,
    otherExportsStillWork: true,
  });
});

test.concurrent('"bun": mock.module replaces a binding without constructing the property it shadows', async () => {
  const { stderr, exitCode } = await run(
    {
      "reexport.mjs": bunReexport,
      "lazy.test.ts": `
        import { expect, mock, test } from "bun:test";
        import * as reexported from "./reexport.mjs";
        import { constructed } from "./bun-helper.mjs";

        test("mock.module('bun')", () => {
          expect(constructed()).toEqual([]);
          mock.module("bun", () => ({ SQL: "mocked" }));
          expect(reexported.SQL).toBe("mocked");
          expect(reexported.Glob).toBe(Bun.Glob);
          // The mock went into the module binding; Bun.SQL itself was neither read nor replaced.
          expect(constructed()).toEqual(["Glob"]);
          expect(typeof Bun.SQL).toBe("function");
        });
      `,
    },
    ["test", "lazy.test.ts"],
  );
  expect(stderr).toContain(" 1 pass");
  expect(stderr).toContain(" 0 fail");
  expect(exitCode).toBe(0);
});
