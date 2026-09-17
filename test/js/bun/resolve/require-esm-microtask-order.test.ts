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

// The import()ed file is transpiled on the thread pool by default, so its fetch
// is still pending when the require() returns. With the thread pool off the
// fetch has already settled inside the require(), which is the case where the
// loader used to carry straight on into evaluation.
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

  test.concurrent("require(esm) does not evaluate an import() the required module starts", async () => {
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

  test.concurrent(
    "require(esm): import() of a throwing or top-level-await module does not run inside the require()",
    async () => {
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
    },
  );

  test.concurrent(
    "require(esm) reached from an ESM entry does not evaluate an import() the required module starts",
    async () => {
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
    },
  );

  test.concurrent("require(esm): a module can import() and then require() the same file", async () => {
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
});

test.concurrent("require(esm) does not run user `await` continuations ahead of earlier microtasks", async () => {
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
