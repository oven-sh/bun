// require(esm) drives the C++ module loader through a private synchronous
// queue so the loader's own pipeline reactions don't yield to user microtasks.
// That diversion must NOT capture user-visible continuations: an `await`
// inside an evaluated module body (AsyncFunctionResume) is a normal microtask
// and has to interleave with one queued *before* the require() in FIFO order,
// and a dynamic import() a module in that graph issues is a separate
// asynchronous load whose modules must not evaluate inside the require().
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Shared by the dynamic import() tests below: `t` records evaluation order and
// is printed once the process has nothing left to do.
const trace = `globalThis.t = []; process.on("exit", () => console.log(JSON.stringify(t)));`;

// The dependencies of an import() target load after the require() returns: on
// the thread pool by default, on the main thread with the flag. Both ways must
// give the same order.
//
// Not `test.concurrent`: each test is one CPU-bound child process, and a
// debug+ASAN build that starts them all at once runs each close to the timeout.
describe.each([
  ["async transpiler", {}],
  ["sync transpiler", { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" }],
])("%s", (_, extraEnv) => {
  async function run(dir: string, entry: string): Promise<string[]> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      env: { ...bunEnv, ...extraEnv },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout.trim());
  }

  test("require(esm) does not evaluate an import() the required module starts", async () => {
    using dir = tempDir("require-esm-dynamic-import", {
      "package.json": `{"name": "r"}`,
      "entry.cjs": `
        ${trace}
        t.push("before-require");
        require("./a.mjs");
        t.push("after-require");
        require("./z.cjs");
        t.push("end");
      `,
      "a.mjs": `
        t.push("a");
        import("./x.mjs").then(() => t.push("x-resolved"));
        export const a = 1;
      `,
      "x.mjs": `import "./y.cjs"; t.push("x"); export const x = 1;`,
      "y.cjs": `t.push("y"); module.exports = {};`,
      "z.cjs": `t.push("z"); module.exports = {};`,
    });

    // Node: before-require a after-require z end y x x-resolved
    expect(await run(String(dir), "entry.cjs")).toEqual([
      "before-require",
      "a",
      "after-require",
      "z",
      "end",
      "y",
      "x",
      "x-resolved",
    ]);
  });

  test("require(esm): import() of a throwing or top-level-await module does not run inside the require()", async () => {
    using dir = tempDir("require-esm-dynamic-import-tla", {
      "package.json": `{"name": "r"}`,
      "entry.cjs": `
          ${trace}
          t.push("before-require");
          require("./a.mjs");
          t.push("after-require");
        `,
      "a.mjs": `
          t.push("a");
          import("./tla.mjs").then(() => t.push("tla-resolved"));
          import("./throws.mjs").catch(e => t.push("throws-rejected:" + e.message));
          export const a = 1;
        `,
      "tla.mjs": `t.push("tla-before-await"); await 1; t.push("tla-after-await"); export const v = 1;`,
      "throws.mjs": `t.push("throws"); throw new Error("boom");`,
    });

    const t = await run(String(dir), "entry.cjs");
    // Nothing from either import() target runs before require() returns. The
    // two targets are fetched concurrently, so only assert each one's own order.
    expect(t.slice(0, 3)).toEqual(["before-require", "a", "after-require"]);
    expect(t.filter(e => e.startsWith("tla"))).toEqual(["tla-before-await", "tla-after-await", "tla-resolved"]);
    expect(t.filter(e => e.startsWith("throws"))).toEqual(["throws", "throws-rejected:boom"]);
    expect(t.length).toBe(8);
  });

  test("require(esm) reached from an ESM entry does not evaluate an import() the required module starts", async () => {
    using dir = tempDir("require-esm-dynamic-import-esm-entry", {
      "package.json": `{"name": "r"}`,
      "entry.mjs": `
          import "./c1.cjs";
          import "./b.mjs";
          t.push("entry");
        `,
      "c1.cjs": `
          ${trace}
          t.push("c1");
          require("./a.mjs");
          t.push("c1-after-require");
        `,
      "a.mjs": `
          t.push("a");
          import("./x.mjs").then(() => t.push("x-resolved"));
          export const a = 1;
        `,
      "b.mjs": `t.push("b"); export const b = 1;`,
      "x.mjs": `import "./y.cjs"; t.push("x"); export const x = 1;`,
      "y.cjs": `t.push("y"); module.exports = {};`,
    });

    const t = await run(String(dir), "entry.mjs");
    // Node: c1 a c1-after-require b entry y x x-resolved. The import()'s graph
    // loads concurrently with the rest of the entry's graph, so only pin down
    // that none of it runs inside the require() and that each graph keeps its
    // own order.
    expect(t.slice(0, 3)).toEqual(["c1", "a", "c1-after-require"]);
    expect(t.filter(e => e === "b" || e === "entry")).toEqual(["b", "entry"]);
    expect(t.filter(e => e.startsWith("x") || e === "y")).toEqual(["y", "x", "x-resolved"]);
    expect(t.length).toBe(8);
  });

  test("require(esm): a module can import() and then require() the same file", async () => {
    using dir = tempDir("require-esm-dynamic-import-then-require", {
      "package.json": `{"name": "r"}`,
      "entry.cjs": `
        ${trace}
        t.push("before-require");
        const { viaRequire } = require("./a.mjs");
        t.push("after-require:" + viaRequire);
      `,
      "a.mjs": `
        import { createRequire } from "node:module";
        t.push("a");
        const viaImport = import("./x.mjs");
        export const viaRequire = createRequire(import.meta.url)("./x.mjs").x;
        viaImport.then(ns => t.push("x-resolved:" + ns.x + ":" + (ns.bump === createRequire(import.meta.url)("./x.mjs").bump)));
      `,
      "x.mjs": `t.push("x"); export const x = 1; export function bump() {}`,
    });

    // x.mjs evaluates once, synchronously, because it is require()d; the earlier
    // import() resolves afterwards with the same namespace.
    expect(await run(String(dir), "entry.cjs")).toEqual([
      "before-require",
      "a",
      "x",
      "after-require:1",
      "x-resolved:1:true",
    ]);
  });

  // The import() target is a module the entry's own load still has in flight:
  // c.cjs, whose body is running, or the entry itself. Run inside the
  // require(), the loader made c.cjs's module record from its half-filled
  // exports and linked and evaluated the entry against it: a default import
  // read `undefined`, a named import failed with "Export named 'v' not found".
  describe.each([
    ["default import", `import d from "./c.cjs"; t.push("m0 reads " + d.v);`],
    ["named import", `import { v } from "./c.cjs"; t.push("m0 reads " + v);`],
  ])("%s", (_, m0) => {
    test.each(["./c.cjs", "./m0.mjs"])(
      "require(esm): import(%j) from the required module does not link the entry against half-filled exports",
      async target => {
        using dir = tempDir("require-esm-dynamic-import-in-flight", {
          "package.json": `{"name": "r"}`,
          "m0.mjs": m0,
          "c.cjs": `
            ${trace}
            require("./e.mjs");
            exports.v = "v";
            t.push("c ends");
          `,
          "e.mjs": `
            import(${JSON.stringify(target)}).then(
              () => t.push("import fulfilled"),
              e => t.push("import rejected: " + e.name),
            );
            t.push("e ends");
          `,
        });

        const t = await run(String(dir), "m0.mjs");
        // The import() settles once its target is loaded, which for c.cjs can
        // be before or after the entry's body runs.
        expect(t.filter(e => !e.startsWith("import "))).toEqual(["e ends", "c ends", "m0 reads v"]);
        expect(t.filter(e => e.startsWith("import "))).toEqual(["import fulfilled"]);
      },
    );
  });

  // x.cjs names neither module, exports nor require. The import() must get the
  // CommonJS module that require() makes for the file, not a second copy of it.
  test.each([
    ["require(x) first", `require("./x.cjs"); require("./a.mjs");`],
    ["require(a) first", `require("./a.mjs"); require("./x.cjs");`],
  ])("require(esm): import() of a side-effect-only .cjs file runs it once (%s)", async (_, requires) => {
    using dir = tempDir("require-esm-dynamic-import-plain-cjs", {
      "package.json": `{"name": "r"}`,
      "main.cjs": `
        ${trace}
        ${requires}
        globalThis.p.then(() => t.push("x.cjs ran " + globalThis.N + " time(s)"));
      `,
      "a.mjs": `globalThis.p = import("./x.cjs");`,
      "x.cjs": `globalThis.N = (globalThis.N ?? 0) + 1;`,
    });

    expect(await run(String(dir), "main.cjs")).toEqual(["x.cjs ran 1 time(s)"]);
  });

  // m.mjs, started by import() inside lib.cjs's require(), imports lib.cjs
  // itself. Run inside the require() it saw lib.cjs half done, and the
  // namespace it got for lib.cjs kept missing `v` for good.
  test("require(esm): import() of a module that imports the requiring CommonJS module", async () => {
    using dir = tempDir("require-esm-dynamic-import-cjs-importer", {
      "package.json": `{"name": "r"}`,
      "main.cjs": `
        globalThis.t = [];
        process.on("exit", () => {
          t.push("at exit: " + globalThis.libNamespace.v);
          console.log(JSON.stringify(t));
        });
        require("./lib.cjs");
      `,
      "lib.cjs": `
        require("./e.mjs");
        exports.v = "v";
      `,
      "e.mjs": `import("./m.mjs");`,
      "m.mjs": `
        import d, * as ns from "./lib.cjs";
        t.push("at load: " + d.v);
        globalThis.libNamespace = ns;
      `,
    });

    expect(await run(String(dir), "main.cjs")).toEqual(["at load: v", "at exit: v"]);
  });

  // p.mjs, started by import() inside the entry's require(), imports the entry.
  // Run inside the require() it read the entry's `v` before the entry had
  // initialized it.
  test("require(esm): import() of a module that imports the requiring ES module", async () => {
    using dir = tempDir("require-esm-dynamic-import-esm-importer", {
      "package.json": `{"name": "r"}`,
      "m0.mjs": `
        import { createRequire } from "node:module";
        ${trace}
        createRequire(import.meta.url)("./e.mjs");
        export const v = "v";
        t.push("m0 ends");
      `,
      "e.mjs": `import("./p.mjs").catch(e => t.push("p failed: " + e.name));`,
      "p.mjs": `
        import { v } from "./m0.mjs";
        t.push("p reads " + v);
      `,
    });

    expect(await run(String(dir), "m0.mjs")).toEqual(["m0 ends", "p reads v"]);
  });

  // import() of a module whose body is still running (it is the one that
  // called require()). Run inside the require(), Evaluate() was entered a
  // second time for that module: the promise never settled, and neither did
  // any later import() of the same module.
  test.each([
    [
      "the ES entry",
      "e.mjs",
      {
        "e.mjs": `
          import { createRequire } from "node:module";
          ${trace}
          createRequire(import.meta.url)("./d.mjs");
          setImmediate(() => import("./e.mjs").then(() => t.push("later: fulfilled")));
          t.push("e ends");
        `,
        "d.mjs": `import("./e.mjs").then(() => t.push("first: fulfilled"));`,
      },
    ],
    [
      "a dependency of a CommonJS entry",
      "e.cjs",
      {
        "e.cjs": `
          ${trace}
          require("./b.mjs");
          setImmediate(() => import("./c.mjs").then(() => t.push("later: fulfilled")));
          t.push("e ends");
        `,
        "b.mjs": `import "./c.mjs";`,
        "c.mjs": `
          import { createRequire } from "node:module";
          createRequire(import.meta.url)("./d.mjs");
        `,
        "d.mjs": `import("./c.mjs").then(() => t.push("first: fulfilled"));`,
      },
    ],
  ])("require(esm): import() of the still-running requiring module settles (%s)", async (_, entry, files) => {
    using dir = tempDir("require-esm-dynamic-import-running", { "package.json": `{"name": "r"}`, ...files });

    expect(await run(String(dir), entry)).toEqual(["e ends", "first: fulfilled", "later: fulfilled"]);
  });
});

test("require(esm) does not run user `await` continuations ahead of earlier microtasks", async () => {
  using dir = tempDir("require-esm-microtask-order", {
    "esm.mjs": `
      globalThis.__order ??= [];
      // Fire-and-forget async IIFE — its first await resumes via
      // AsyncFunctionResume, which is what the sync queue must NOT divert.
      (async () => {
        await Promise.resolve();
        globalThis.__order.push("await-inside-esm");
      })();
      export const loaded = true;
    `,
    "entry.cjs": `
      globalThis.__order = [];
      Promise.resolve().then(() => globalThis.__order.push("then-before-require"));
      const m = require("./esm.mjs");
      if (!m.loaded) throw new Error("esm not loaded");
      globalThis.__order.push("after-require");
      queueMicrotask(() => {
        // By now both earlier microtasks have drained in FIFO order.
        console.log(JSON.stringify(globalThis.__order));
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual(["after-require", "then-before-require", "await-inside-esm"]);
  expect(exitCode).toBe(0);
});
