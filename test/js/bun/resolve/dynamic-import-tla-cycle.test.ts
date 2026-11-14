import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A top-level-awaited dynamic import whose target statically imports the
// awaiting module back. The spec's innerModuleEvaluation 11.c.v would have the
// chunk wait on the entry's async-evaluation order, but the entry can only
// finish once the chunk's evaluate() promise settles — a self-deadlock. Bun
// matches the pre-rewrite loader and lets the chunk evaluate immediately
// against the entry's already-initialised bindings.
test("dynamic import inside TLA whose target imports the awaiter back does not deadlock", async () => {
  using dir = tempDir("dyn-tla-cycle", {
    "index.mjs": `
      import fs from "node:fs";
      export const x = 42;
      const chunk = await import("./chunks/stream.mjs");
      console.log("chunk loaded:", chunk.handler());
    `,
    "chunks/stream.mjs": `
      import { x } from "../index.mjs";
      import fs from "node:fs";
      export const handler = () => x + (fs.existsSync("/") ? 1 : 0);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("chunk loaded: 43");
  expect(exitCode).toBe(0);
});

// Same self-deadlock pattern, but the awaiting module is not the Evaluate()
// entry — it's a static dependency of the entry. The cycle root re-entered by
// the chunk has no TopLevelCapability of its own, so the discriminator must
// be "has its body started" (pendingAsyncDependencies == 0), not "is it the
// Evaluate() entry".
test("dynamic import inside TLA of a non-entry module whose target imports it back does not deadlock", async () => {
  using dir = tempDir("dyn-tla-cycle-nonentry", {
    "entry.mjs": `
      import { result } from "./mid.mjs";
      console.log("result:", result);
    `,
    "mid.mjs": `
      export const x = 42;
      const chunk = await import("./chunk.mjs");
      export const result = chunk.handler();
    `,
    "chunk.mjs": `
      import { x } from "./mid.mjs";
      export const handler = () => x + 1;
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("result: 43");
  expect(exitCode).toBe(0);
});

// The deadlock-avoidance above must NOT fire for sibling static imports in the
// same Evaluate() pass. Here `entry` first imports `a` (in an SCC {a,c} with
// an async dep), popping the SCC to EvaluatingAsync, then imports `b` which
// reads a binding from `c`. `b` must wait for the SCC; previously the
// EvaluatingAsync check made it skip the wait and run with `c`'s bindings
// still in TDZ. Node and pre-rewrite Bun both wait.
test("static sibling import waits for an async-pending SCC from the same Evaluate()", async () => {
  using dir = tempDir("static-sibling-async-scc", {
    "entry.mjs": `
      import "./a.mjs";
      import { read } from "./b.mjs";
      console.log("got:", read);
    `,
    "a.mjs": `
      import { C_VAL } from "./c.mjs";
      export function aFn() { return C_VAL; }
    `,
    "c.mjs": `
      import { aFn } from "./a.mjs"; // closes the cycle
      import "./tla.mjs";
      export const C_VAL = "c";
    `,
    "tla.mjs": `
      // Runtime-false guard: marks the module HasTLA without ever suspending.
      // Mirrors the "if (process.argv[1] === import.meta.filename) await main()"
      // pattern in dual CLI/library files.
      if (globalThis.__never) await 0;
    `,
    "b.mjs": `
      import { C_VAL } from "./c.mjs";
      export const read = C_VAL;
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("got: c");
  expect(exitCode).toBe(0);
});

// #30259: same narrowing as above, but the TLA dep has NO async deps of its own
// (pendingAsyncDependencies == 0) and is re-imported by a sibling subtree in the
// same Evaluate(). Previously the discriminator was only "body has been entered"
// which is also true here — `await.ts` is suspended at its first await — so the
// sibling skipped the wait and ran with `foo` still in TDZ. The discriminator
// must additionally check the dep entered EvaluatingAsync in a *prior*
// Evaluate(); within the same DFS the spec wait is required.
test("static sibling import waits for a TLA dep that suspended earlier in the same Evaluate()", async () => {
  using dir = tempDir("static-sibling-tla", {
    "root.ts": `
      import { foo } from "./await.ts";
      import "./child.ts";
      void foo;
    `,
    "await.ts": `
      await 0;
      export const foo = 123;
    `,
    "child.ts": `
      import { foo } from "./await.ts";
      console.log(foo);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "root.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("123");
  expect(exitCode).toBe(0);
});

// Same as above but the TLA dep is reached indirectly through different parents
// (so neither parent is on the DFS stack when the second one visits it). Guards
// against discriminating by "is an asyncParentModule on the stack".
test("static sibling import waits for an indirectly-shared TLA dep in the same Evaluate()", async () => {
  using dir = tempDir("static-sibling-tla-indirect", {
    "root.ts": `
      import "./a.ts";
      import "./b.ts";
    `,
    "a.ts": `
      import { foo } from "./await.ts";
      void foo;
    `,
    "b.ts": `
      import { foo } from "./await.ts";
      console.log(foo);
    `,
    "await.ts": `
      await 0;
      export const foo = 456;
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "root.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("456");
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/30634
test("sibling dynamic imports sharing a TLA wrapper wait for its post-await exports", async () => {
  using dir = tempDir("dyn-tla-shared-wrapper", {
    "entry.mjs": `
      const [c1, c2] = await Promise.all([import("./consumer1.mjs"), import("./consumer2.mjs")]);
      console.log(c1.FOO, c2.BAR);
    `,
    "wrapper.mjs": `
      const mod = await import("./inner.mjs");
      export const FOO = mod.FOO;
      export const BAR = mod.BAR;
    `,
    "inner.mjs": `
      export const FOO = "foo";
      export const BAR = "bar";
    `,
    "consumer1.mjs": `
      import { FOO as wrapped } from "./wrapper.mjs";
      export const FOO = wrapped;
    `,
    "consumer2.mjs": `
      import { BAR as wrapped } from "./wrapper.mjs";
      export const BAR = wrapped;
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("foo bar");
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/41029
//
// The import() that closes the cycle is not written in the awaiting module. A
// helper module issues it, and the entry awaits the helper. The deadlock is the
// same: the chunk waits for the entry (12.b.v), the entry waits for the helper,
// the helper waits for the chunk. The skip has to follow the await chain hanging
// off the import() promise back to the suspended entry, whatever code issued
// the import() and however many promises sit in between.
describe("dynamic import through a helper whose target imports the TLA awaiter back", () => {
  async function run(files: Record<string, string>, entry = "entry.ts") {
    using dir = tempDir("dyn-tla-helper-cycle", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  const child = `
    import { helper } from "./entry.ts";
    export function start() { return helper(); }
  `;

  // The issue's repro: two levels of import(), the helper calls import()
  // synchronously and awaits it.
  test.concurrent("helper reached by import(), import() before the helper's first await", async () => {
    const result = await run({
      "entry.ts": `
        export function helper() { return "helper from entry"; }
        const { load } = await import("./loader.ts");
        await load();
        console.log("BOOT OK");
      `,
      "loader.ts": `
        export async function load() {
          const m = await import("./child.ts");
          console.log("child:", m.start());
        }
      `,
      "child.ts": child,
    });
    expect(result).toEqual({ stdout: "child: helper from entry\nBOOT OK", stderr: "", exitCode: 0 });
  });

  // A plugin loader: statically imported, scans a directory, then imports what
  // it found. The entry's body is long gone from the stack when import() runs.
  test.concurrent("statically imported async helper that awaits I/O before import()", async () => {
    const result = await run({
      "entry.ts": `
        export function helper() { return "helper from entry"; }
        import { load } from "./loader.ts";
        await load();
        console.log("BOOT OK");
      `,
      "loader.ts": `
        import { readdir } from "node:fs/promises";
        export async function load() {
          const files = (await readdir(new URL("./plugins/", import.meta.url))).sort();
          for (const file of files) {
            const m = await import("./plugins/" + file);
            console.log("plugin:", file, m.start());
          }
        }
      `,
      "plugins/a.ts": `
        import { helper } from "../entry.ts";
        export function start() { return "a:" + helper(); }
      `,
      "plugins/b.ts": `
        import { helper } from "../entry.ts";
        export function start() { return "b:" + helper(); }
      `,
    });
    expect(result).toEqual({
      stdout: "plugin: a.ts a:helper from entry\nplugin: b.ts b:helper from entry\nBOOT OK",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("three levels of import()", async () => {
    const result = await run({
      "entry.ts": `
        export function helper() { return "helper from entry"; }
        const { load } = await import("./loader.ts");
        await load();
        console.log("BOOT OK");
      `,
      "loader.ts": `
        export async function load() {
          await 0;
          const { loadMore } = await import("./loader2.ts");
          await loadMore();
        }
      `,
      "loader2.ts": `
        export async function loadMore() {
          await 0;
          const m = await import("./child.ts");
          console.log("child:", m.start());
        }
      `,
      "child.ts": child,
    });
    expect(result).toEqual({ stdout: "child: helper from entry\nBOOT OK", stderr: "", exitCode: 0 });
  });

  // No await in the helper: its promise is resolved with the import() promise.
  test.concurrent("helper returns the import() promise", async () => {
    const result = await run({
      "entry.ts": `
        export function helper() { return "helper from entry"; }
        import { load } from "./loader.ts";
        const m = await load();
        console.log("child:", m.start());
      `,
      "loader.ts": `
        export function load() {
          return import("./child.ts");
        }
      `,
      "child.ts": child,
    });
    expect(result).toEqual({ stdout: "child: helper from entry", stderr: "", exitCode: 0 });
  });

  test.concurrent("helper chains .then() on the import() promise", async () => {
    const result = await run({
      "entry.ts": `
        export function helper() { return "helper from entry"; }
        import { load } from "./loader.ts";
        console.log("child:", await load());
      `,
      "loader.ts": `
        export function load() {
          return import("./child.ts").then(m => m.start()).finally(() => {});
        }
      `,
      "child.ts": child,
    });
    expect(result).toEqual({ stdout: "child: helper from entry", stderr: "", exitCode: 0 });
  });

  test.concurrent("helper awaits Promise.all of several import()s", async () => {
    const result = await run({
      "entry.ts": `
        export function helper() { return "helper from entry"; }
        import { load } from "./loader.ts";
        await load();
        console.log("BOOT OK");
      `,
      "loader.ts": `
        export async function load() {
          await 0;
          const [a, b] = await Promise.all([import("./a.ts"), import("./b.ts")]);
          console.log(a.start(), b.start());
        }
      `,
      "a.ts": `
        import { helper } from "./entry.ts";
        export function start() { return "a:" + helper(); }
      `,
      "b.ts": `
        import { helper } from "./entry.ts";
        export function start() { return "b:" + helper(); }
      `,
    });
    expect(result).toEqual({ stdout: "a:helper from entry b:helper from entry\nBOOT OK", stderr: "", exitCode: 0 });
  });

  // Each import() is created when the loop asks for it, so its await is in place
  // before the module graph evaluates. Creating them all up front is a race: a
  // later import() can evaluate before the loop has reached and awaited it, and
  // then nothing shows that the entry waits for it.
  test.concurrent("helper iterates import() promises with for await", async () => {
    const result = await run({
      "entry.ts": `
        export function helper() { return "helper from entry"; }
        import { load } from "./loader.ts";
        await load();
        console.log("BOOT OK");
      `,
      "loader.ts": `
        function* plugins() {
          yield import("./a.ts");
          yield import("./b.ts");
        }
        export async function load() {
          await 0;
          for await (const m of plugins()) {
            console.log(m.start());
          }
        }
      `,
      "a.ts": `
        import { helper } from "./entry.ts";
        export function start() { return "a:" + helper(); }
      `,
      "b.ts": `
        import { helper } from "./entry.ts";
        export function start() { return "b:" + helper(); }
      `,
    });
    expect(result).toEqual({ stdout: "a:helper from entry\nb:helper from entry\nBOOT OK", stderr: "", exitCode: 0 });
  });

  // The awaiting module is a static dependency of the entry, not the entry.
  test.concurrent("awaiter is a non-entry module", async () => {
    const result = await run({
      "entry.ts": `
        import { result } from "./mid.ts";
        console.log("result:", result);
      `,
      "mid.ts": `
        export function helper() { return "helper from mid"; }
        import { load } from "./loader.ts";
        export const result = await load();
      `,
      "loader.ts": `
        export async function load() {
          await 0;
          const m = await import("./chunk.ts");
          return m.start();
        }
      `,
      "chunk.ts": `
        import { helper } from "./mid.ts";
        export function start() { return helper(); }
      `,
    });
    expect(result).toEqual({ stdout: "result: helper from mid", stderr: "", exitCode: 0 });
  });

  // The entry does not await the helper's import(): nothing is deadlocked, so
  // the chunk must wait for the entry (12.b.v) and see its post-await exports.
  // The timer keeps the entry suspended while the chunk loads. A fixed delay
  // is the only option: in the correct outcome the chunk's body does not run
  // until the entry finishes, so nothing on the chunk side can signal the
  // entry, and any promise from the import() back to the entry's await would
  // make the entry wait on the chunk for real. A slow machine can only make
  // this check pass vacuously, never fail.
  test.concurrent("a helper's import() that the awaiter does not wait for still waits for the awaiter", async () => {
    const result = await run({
      "entry.ts": `
        export const early = "early";
        import { preload } from "./loader.ts";
        preload();
        await new Promise(resolve => setTimeout(resolve, 500));
        export const late = "late";
        console.log("entry done");
      `,
      "loader.ts": `
        export function preload() {
          import("./chunk.ts").then(m => console.log("chunk loaded:", m.report));
        }
      `,
      "chunk.ts": `
        import { early, late } from "./entry.ts";
        export const report = early + " " + late;
      `,
    });
    expect(result).toEqual({ stdout: "entry done\nchunk loaded: early late", stderr: "", exitCode: 0 });
  });
});
