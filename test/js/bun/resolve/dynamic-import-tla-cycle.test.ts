import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A top-level-awaited dynamic import whose target statically imports the
// awaiting module back. The spec's innerModuleEvaluation 11.c.v makes the
// chunk wait on the entry's async-evaluation order, but the entry can only
// finish once the chunk's evaluate() promise settles — a self-deadlock, and
// Node prints "unsettled top-level await". Bun used to divert from spec at
// 11.c.v to match the pre-rewrite loader behaviour (let the chunk evaluate
// immediately against the entry's already-initialised bindings), but that
// custom skip also fired for unrelated sibling dynamic imports and left
// their importers reading post-`await` exports while they were still in
// TDZ (#30634 — breaks @lexical/react and other packages that dispatch
// dev/prod via `await import()` in a wrapper module). The skip was dropped;
// this pattern now matches spec/Node behaviour (deadlock). Reinstating a
// narrower skip that distinguishes the self-deadlock case from the
// sibling-race case requires threading the dynamic-import referrer from
// Bun's moduleLoaderImportModule hook through ModuleLoaderPayload to the
// evaluate path — tracked for follow-up.
test.todo("dynamic import inside TLA whose target imports the awaiter back does not deadlock");
test.todo("dynamic import inside TLA of a non-entry module whose target imports it back does not deadlock");

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

// #30634: sibling dynamic imports from the event loop (Promise.all of two
// top-level import() calls) that share a TLA wrapper dep. Each import() is
// its own Evaluate() at the top of the stack, so by the time consumer2's DFS
// visits wrapper, wrapper is EvaluatingAsync (popped at the end of consumer1's
// DFS), its asyncEvaluationOrder is below the new watermark, and its
// pendingAsyncDependencies is 0 — matching every earlier discriminator.
// But wrapper's post-`await` `export const` assignments have not run yet
// (its continuation is queued in the microtask queue, not on the C++ stack),
// so skipping the spec wait runs consumer2 with wrapper's exports in TDZ.
// The discriminator must additionally require the dep's body to be actively
// executing on the JS call stack (Field::State == Executing) — true for
// require(esm)/dynamic-import re-entry from inside wrapper's continuation,
// false for a sibling import racing in from a fresh event-loop turn.
test("sibling dynamic imports in Promise.all wait for a shared TLA wrapper", async () => {
  using dir = tempDir("sibling-dynamic-tla", {
    "entry.mjs": `
      await Promise.all([import("./consumer1.mjs"), import("./consumer2.mjs")]);
      console.log("ok");
    `,
    "wrapper.mjs": `
      const mod = await import("./inner.mjs");
      export const FOO = mod.FOO;
      export const BAR = mod.BAR;
    `,
    "inner.mjs": `
      export const FOO = "hello";
      export const BAR = "world";
    `,
    "consumer1.mjs": `
      import { FOO } from "./wrapper.mjs";
      console.log("c1:", FOO);
    `,
    "consumer2.mjs": `
      import { BAR } from "./wrapper.mjs";
      console.log("c2:", BAR);
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
  // Order of c1/c2 isn't part of the contract — both must appear with their
  // correct bindings, and the final "ok" must print.
  const lines = stdout.trim().split("\n").sort();
  expect(lines).toEqual(["c1: hello", "c2: world", "ok"]);
  expect(exitCode).toBe(0);
});
