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

// "bun", "node:process" and "node:module" are generated natively from an existing object (the Bun object, process,
// the Module constructor; see BUN_FOREACH_LAZY_ESM_NATIVE_MODULE). Most of those objects' properties are
// PropertyCallback entries of a static table that construct their value (a class, the shell, the default
// SQL/S3/Redis clients, the stdio streams, the builtinModules array, ...) the first time they are read, at which
// point they become own properties of the object. bun:jsc's describe() dumps the object's Structure, i.e. exactly the
// set of properties that have been constructed, which is the readout used here. (Object.keys and Reflect.ownKeys list
// static entries without constructing them; for...in constructs all of them, so the entries below avoid it.) The
// watched names are a sample of those entries plus the plain function (`write`, `createRequire`) an entry imports.
//
// Note that a literal `import ... from "bun"` (and `import("bun")` / `require("bun")`) is rewritten by the
// transpiler into a read of globalThis.Bun and never loads the module; the module is what `export ... from "bun"`
// and a non-literal import() specifier go through. Imports of node:process and node:module always load the module.
const WATCHED = ["$", "CryptoHasher", "Glob", "S3Client", "SQL", "TOML", "Transpiler", "secrets", "write"] as const;
const PROCESS_WATCHED = ["allowedNodeEnvironmentFlags", "config", "release", "stderr", "stdin", "stdout", "versions"];
const MODULE_WATCHED = [
  "SourceMap",
  "_cache",
  "_extensions",
  "builtinModules",
  "constants",
  "createRequire",
  "globalPaths",
];

const nativeHelper = `
  import { describe } from "bun:jsc";
  /** The names out of \`watched\` that are own properties of \`object\` by now, i.e. whose value has been constructed. */
  function constructedOn(object, watched) {
    const properties = /\\{([^}]*)\\}/.exec(describe(object))[1];
    const names = properties.split(",").map(entry => entry.trim().split(":")[0]);
    return watched.filter(name => names.includes(name));
  }
  export const constructed = () => constructedOn(Bun, ${JSON.stringify(WATCHED)});
  export const constructedOnProcess = () => constructedOn(process, ${JSON.stringify(PROCESS_WATCHED)});
  // getBuiltinModule hands out the constructor itself without going through the ES module.
  export const constructedOnModule = () =>
    constructedOn(process.getBuiltinModule("node:module"), ${JSON.stringify(MODULE_WATCHED)});
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
  using dir = tempDir("builtin-esm-lazy-exports", {
    "helper.mjs": helper,
    "native-helper.mjs": nativeHelper,
    ...files,
  });
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

// Object.seal / Object.freeze on the exports object (a lockdown helper, or a library freezing what it re-exports) makes
// the accessors non-configurable, so they can never be replaced by the value they load. They still have to hand it
// out: to require() callers, to every module that links one of these names, and to whatever enumerates a namespace.
// The replacement used to be an Object.defineProperty that threw "Attempting to change configurable attribute of
// unconfigurable property" out of every one of those reads.
for (const lock of ["seal", "freeze"] as const) {
  test.concurrent(`the accessors keep working after Object.${lock} of the exports object`, async () => {
    const result = await runEntry(
      `
        const fs = require("node:fs");
        Object.${lock}(fs);
        // helper.mjs imports node:fs, so every ES module import of the builtin below happens after the ${lock}.
        const { STREAMS, kinds, print } = await import("./helper.mjs");
        const names = Object.fromEntries(STREAMS.map(name => [name, fs[name].name]));
        // Linking streams.mjs is what reads ReadStream and FileWriteStream on its behalf.
        const { ReadStream, FileWriteStream } = await import("./streams.mjs");
        const ns = await import("node:fs");
        const namespaceKeys = Object.keys(ns);
        fs.WriteStream = "assigned";
        print({
          names,
          secondReadIsStable: fs.ReadStream === fs.ReadStream && fs.FileReadStream === fs.ReadStream,
          linked: ReadStream === fs.ReadStream && FileWriteStream === fs.FileWriteStream,
          keysMatch: namespaceKeys.sort().join() === [...Object.keys(fs), "default"].sort().join(),
          namespaceHasTheClasses: STREAMS.every(name => typeof ns[name] === "function" && ns[name] === fs[name]),
          assignmentIsIgnored: fs.WriteStream === FileWriteStream,
          stillAccessors: kinds(),
        });
      `,
      {
        "streams.mjs": `
          import { ReadStream, FileWriteStream } from "node:fs";
          export { ReadStream, FileWriteStream };
        `,
      },
    );
    expect(result).toEqual({
      names: {
        ReadStream: "ReadStream",
        WriteStream: "WriteStream",
        FileReadStream: "ReadStream",
        FileWriteStream: "WriteStream",
        Utf8Stream: "Utf8Stream",
      },
      secondReadIsStable: true,
      linked: true,
      keysMatch: true,
      namespaceHasTheClasses: true,
      assignmentIsIgnored: true,
      stillAccessors: kinds(),
    });
  });
}

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

// node:util and node:readline define their lazy exports with defineLazyProperties (internal/shared). Those are data
// properties, not accessors, so the readout is the number of functions on the heap: internal/util/inspect adds about
// 230 when it loads.
test.concurrent("node:util: importing the module does not load internal/util/inspect", async () => {
  const result = await runEntry(`
    import { heapStats } from "bun:jsc";
    import { createRequire } from "node:module";
    import { print } from "./helper.mjs";
    const require = createRequire(import.meta.url);
    const util = require("node:util");
    const functions = () => heapStats().objectTypeCounts.Function;
    const beforeImport = functions();
    const ns = await import("node:util");
    const afterImport = functions();
    const inspect = ns.inspect;
    const afterRead = functions();
    const readline = await import("node:readline");
    print({
      importLoadedInspect: afterImport - beforeImport > 100,
      readLoadedInspect: afterRead - afterImport > 100,
      sameFunction: inspect === util.inspect && ns.format === util.format,
      readlinePromises: readline.promises === require("node:readline/promises"),
    });
  `);
  expect(result).toEqual({
    importLoadedInspect: false,
    readLoadedInspect: true,
    sameFunction: true,
    readlinePromises: true,
  });
});

// Node's ESM facade for a builtin copies the exports when the facade is created. A value that user code stored
// before that is what gets bound.
test.concurrent("node:util: a value stored before the first import is what gets bound", async () => {
  const result = await runEntry(`
    import { createRequire } from "node:module";
    import { print } from "./helper.mjs";
    const util = createRequire(import.meta.url)("node:util");
    const stub = () => "stub";
    util.format = stub;
    const ns = await import("node:util");
    print({ format: ns.format === stub, inspect: ns.inspect === util.inspect });
  `);
  expect(result).toEqual({ format: true, inspect: true });
});

// A lazy binding of node:util is read on first use, from the module's own values. So a spy on the exports object does
// not reach it, during the spy or after mockRestore(). In Node, the facade keeps the module's values too.
test.concurrent("node:util: a spy on the exports object does not reach the ESM bindings", async () => {
  const { stderr, exitCode } = await run(
    {
      "namespace.mjs": `import * as util from "node:util";\nexport const viaNamespace = (...args) => util.format(...args);\n`,
      "named.mjs": `import { format } from "node:util";\nexport const viaNamed = (...args) => format(...args);\n`,
      "spy.test.mjs": `
        import { expect, spyOn, test } from "bun:test";
        import util from "node:util";
        import { viaNamespace } from "./namespace.mjs";

        test("the first read of each binding happens during the spy", async () => {
          const spy = spyOn(util, "format").mockReturnValue("mocked");
          try {
            expect(util.format("%s", "x")).toBe("mocked");
            expect(viaNamespace("%s", "x")).toBe("x");
            const { viaNamed } = await import("./named.mjs");
            expect(viaNamed("%s", "y")).toBe("y");
          } finally {
            spy.mockRestore();
          }
        });

        test("the bindings still format after mockRestore", async () => {
          const { viaNamed } = await import("./named.mjs");
          expect([viaNamespace("%s!", "a"), viaNamed("%s!", "b"), util.format("%s!", "c")]).toEqual(["a!", "b!", "c!"]);
        });
      `,
    },
    ["test", "./spy.test.mjs"],
  );
  expect(stderr).toContain(" 2 pass\n");
  expect(stderr).toContain(" 0 fail\n");
  expect(exitCode).toBe(0);
});

test.concurrent('"bun": re-exports construct the properties that get bound, not the rest of the object', async () => {
  const result = await runEntry(
    `
      // Linking this import is what constructs Bun.write; nothing else is read.
      import { write } from "./reexport.mjs";
      import * as reexported from "./reexport.mjs";
      import { constructed, print } from "./native-helper.mjs";
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
    import { constructed, print, specifier } from "./native-helper.mjs";
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
      import { print } from "./native-helper.mjs";
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
        import { constructed } from "./native-helper.mjs";

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

test.concurrent("node:process: linking constructs the linked bindings, not the stdio streams", async () => {
  const result = await runEntry(`
    import proc, { on, release } from "node:process";
    import * as ns from "node:process";
    import { constructedOnProcess, print } from "./native-helper.mjs";
    const afterLink = constructedOnProcess();
    // The exports are the enumerable names of process and its prototype chain, as listed when the module loaded.
    // (Object.keys does not reify anything, unlike for...in, and nothing has changed the chain since loading: that
    // happens further down, when reading stdout loads node:events.)
    const enumerable = new Set();
    for (let object = process; object !== null; object = Object.getPrototypeOf(object)) {
      for (const name of Object.keys(object)) enumerable.add(name);
    }
    const exportNames = Reflect.ownKeys(ns).filter(key => typeof key === "string");
    const exportListMatches = exportNames.sort().join() === [...enumerable, "default"].sort().join();
    const afterListing = constructedOnProcess();
    const stdout = ns.stdout;
    print({
      defaultIsProcess: proc === process,
      afterLink,
      release: release === process.release,
      // Inherited from the EventEmitter prototype, so it was never stored on process itself.
      on: on === process.on && !Object.hasOwn(process, "on"),
      exportListMatches,
      afterListing,
      stdout: stdout === process.stdout && typeof stdout.write === "function",
      afterStdoutRead: constructedOnProcess(),
      argv: ns.argv === process.argv,
    });
  `);
  expect(result).toEqual({
    defaultIsProcess: true,
    afterLink: ["release"],
    release: true,
    on: true,
    exportListMatches: true,
    afterListing: ["release"],
    stdout: true,
    afterStdoutRead: ["release", "stdout"],
    argv: true,
  });
});

test.concurrent("node:process: a value already stored on the object is exported as it was at load", async () => {
  const result = await runEntry(`
    import { print } from "./native-helper.mjs";
    process.addedBeforeLoad = "at load";
    const ns = await import("node:process");
    process.addedBeforeLoad = "after load";
    process.addedAfterLoad = true;
    print({ addedBeforeLoad: ns.addedBeforeLoad, exportsAddedAfterLoad: "addedAfterLoad" in ns });
  `);
  expect(result).toEqual({ addedBeforeLoad: "at load", exportsAddedAfterLoad: false });
});

test.concurrent("node:module: linking constructs the linked bindings, not the rest of the table", async () => {
  const result = await runEntry(`
    import Module, { createRequire } from "node:module";
    import * as ns from "node:module";
    import { constructedOnModule, print } from "./native-helper.mjs";
    const afterLink = constructedOnModule();
    const exportNames = Reflect.ownKeys(ns).filter(key => typeof key === "string");
    // The export list is the static table, which is also exactly what Object.keys of the constructor lists.
    const exportListMatches = exportNames.sort().join() === [...Object.keys(Module), "default"].sort().join();
    const afterListing = constructedOnModule();
    const builtinModules = ns.builtinModules;
    print({
      defaultIsTheConstructor: Module === process.getBuiltinModule("node:module"),
      afterLink,
      createRequire: typeof createRequire(import.meta.url)("node:path").join === "function",
      exportListMatches,
      afterListing,
      builtinModules: Array.isArray(builtinModules) && builtinModules === Module.builtinModules,
      afterRead: constructedOnModule(),
      // Backed by an accessor rather than a constructed value; the binding gets what the accessor returns.
      resolveFilename: ns._resolveFilename === Module._resolveFilename && typeof ns._resolveFilename === "function",
    });
  `);
  expect(result).toEqual({
    defaultIsTheConstructor: true,
    afterLink: ["createRequire"],
    createRequire: true,
    exportListMatches: true,
    afterListing: ["createRequire"],
    builtinModules: true,
    afterRead: ["builtinModules", "createRequire"],
    resolveFilename: true,
  });
});

// Only exports whose value comes from Bun's own code (a static table entry, a native accessor, a getter compiled from
// src/js) are declared lazily. A lazy export is materialized by JSC while the module importing it is being linked, and
// linking must not run user code (see the re-entrancy tests below), so an accessor that user code defined on the
// object is read when the builtin loads instead, the way every export used to be.

test.concurrent("node:process: a user-defined accessor is read when the module loads, builtins stay lazy", async () => {
  const result = await runEntry(`
    import { constructedOnProcess, print } from "./native-helper.mjs";
    let reads = 0;
    Object.defineProperty(process, "userDefined", { enumerable: true, configurable: true, get: () => ++reads });
    // Nothing binds to userDefined here: a lazy export would not be read at all.
    const ns = await import("node:process");
    print({
      readsAfterLoad: reads,
      afterLoad: constructedOnProcess(),
      value: ns.userDefined,
      readsAfterRead: reads,
      on: ns.on === process.on,
    });
  `);
  expect(result).toEqual({ readsAfterLoad: 1, afterLoad: [], value: 1, readsAfterRead: 1, on: true });
});

test.concurrent("node:fs: a user-defined accessor is read when the module loads, fs's own stay lazy", async () => {
  const result = await runEntry(`
    const fs = require("node:fs");
    let reads = 0;
    Object.defineProperty(fs, "userDefined", { enumerable: true, configurable: true, get: () => ++reads });
    const ns = await import("node:fs");
    console.log(JSON.stringify({
      readsAfterLoad: reads,
      readStreamStillAnAccessor: typeof Object.getOwnPropertyDescriptor(fs, "ReadStream").get === "function",
      value: ns.userDefined,
      readsAfterRead: reads,
    }));
  `);
  expect(result).toEqual({ readsAfterLoad: 1, readStreamStillAnAccessor: true, value: 1, readsAfterRead: 1 });
});

test.concurrent("a user-defined getter can itself load the modules that import the export it backs", async () => {
  // Read while E.mjs linked, the require() evaluated E.mjs inside that link, before the binding it imports had a
  // value: "Cannot access 'userDefined' before initialization". Read while node:process loads, the require() loads
  // E.mjs and X.mjs against the finished binding, and the import() of E.mjs that is under way picks them up.
  const result = await runEntry(
    `
      import { print } from "./native-helper.mjs";
      const log = (globalThis.log = []);
      Object.defineProperty(process, "userDefined", {
        enumerable: true,
        configurable: true,
        get() {
          if (!log.includes("getter")) {
            log.push("getter");
            log.push("require(X) -> " + require("./X.mjs").x);
          }
          return "value";
        },
      });
      const { e } = await import("./E.mjs");
      const { x } = await import("./X.mjs");
      print({ log, e, x });
    `,
    {
      "E.mjs": `import { userDefined } from "node:process";\nglobalThis.log.push("E: " + userDefined);\nexport const e = 1;`,
      "X.mjs": `import "./E.mjs";\nglobalThis.log.push("X");\nexport const x = 2;`,
    },
  );
  expect(result).toEqual({ log: ["getter", "E: value", "X", "require(X) -> 2"], e: 1, x: 2 });
});

// The getter of a user-defined accessor that is exported by a builtin. It require()s Q.mjs and then throws.
//
// When the accessor was read while E.mjs was being linked, the require() linked Q.mjs, Y.mjs and X.mjs inside that
// link. X.mjs imports E.mjs, which was still linking, so X.mjs was marked linked on its own; Y.mjs then threw while
// Q.mjs evaluated, so X.mjs did not evaluate. The getter's throw failed E.mjs's link, which reset E.mjs to unlinked.
// import("./X.mjs") afterwards had nothing left to link, evaluated X.mjs and with it the unlinked E.mjs, and
// segfaulted in JSModuleRecord::evaluate. Read while the builtin loads, the getter runs before anything links against
// the builtin, and its throw fails the builtin's load: every import that depends on it rejects with the getter's error.
const throwingGetter = `{
  enumerable: true,
  configurable: true,
  get() {
    try {
      require("./Q.mjs");
    } catch {}
    throw new Error("getter throws");
  },
}`;

const linkReentrancyCases: {
  name: string;
  install: string;
  exportName: string;
  importFrom: string;
  files?: Record<string, string>;
}[] = [
  {
    name: "node:process, an accessor on process",
    install: `Object.defineProperty(process, "userDefined", ${throwingGetter});`,
    exportName: "userDefined",
    importFrom: "node:process",
  },
  {
    name: "node:process, an accessor process inherits from EventEmitter.prototype",
    install: `Object.defineProperty(require("node:events").prototype, "userDefined", ${throwingGetter});`,
    exportName: "userDefined",
    importFrom: "node:process",
  },
  {
    name: "node:module, a static table entry redefined as an accessor",
    install: `Object.defineProperty(require("node:module"), "globalPaths", ${throwingGetter});`,
    exportName: "globalPaths",
    importFrom: "node:module",
  },
  {
    name: '"bun", an accessor on the Bun object, bound through export *',
    install: `Object.defineProperty(Bun, "userDefined", ${throwingGetter});`,
    exportName: "userDefined",
    importFrom: "./reexport.mjs",
    files: { "reexport.mjs": bunReexport },
  },
  {
    name: "node:fs, an accessor on the exports object of a src/js builtin",
    install: `Object.defineProperty(require("node:fs"), "userDefined", ${throwingGetter});`,
    exportName: "userDefined",
    importFrom: "node:fs",
  },
];

for (const { name, install, exportName, importFrom, files } of linkReentrancyCases) {
  test.concurrent(`a user-defined getter does not run while a module links: ${name}`, async () => {
    const result = await runEntry(
      `
        ${install}
        const result = {};
        try {
          await import("./E.mjs");
          result.E = "evaluated";
        } catch (error) {
          result.E = error.message;
        }
        try {
          result.X = (await import("./X.mjs")).x;
        } catch (error) {
          result.X = error.message;
        }
        console.log(JSON.stringify(result));
      `,
      {
        ...files,
        "E.mjs": `import { ${exportName} } from ${JSON.stringify(importFrom)};\nexport const e = 1;`,
        "X.mjs": `import "./E.mjs";\nexport const x = "evaluated";`,
        "Q.mjs": `import "./Y.mjs";\nimport "./X.mjs";`,
        "Y.mjs": `throw new Error("Y.mjs throws while evaluating");`,
      },
    );
    expect(result).toEqual({ E: "getter throws", X: "getter throws" });
  });
}
