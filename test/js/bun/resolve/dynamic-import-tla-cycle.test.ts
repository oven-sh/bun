import { expect, test } from "bun:test";
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

// A TLA module that is suspended at its await inside an import cycle must be
// resumed even if a sibling module throws while the DFS is still on the stack.
// Previously the resume path in JSModuleRecord::evaluate() saw the graph-level
// evaluationError the cycle root had stamped on it and re-threw instead of
// resuming, silently abandoning everything after the await.
test("TLA module in a cycle resumes after its await when a sibling throws", async () => {
  using dir = tempDir("tla-cycle-sibling-throw", {
    "entry.mjs": `
      globalThis.LOG = [];
      globalThis.FLAG = "never-started";
      try { await import("./a.mjs"); } catch (e) { LOG.push("caught:" + e.message); }
      await 0; await 0; // let any trailing microtasks drain
      console.log(JSON.stringify({ log: LOG, flag: FLAG }));
    `,
    "a.mjs": `
      import "./b.mjs";
      import "./c.mjs";
      LOG.push("a:body");
    `,
    "b.mjs": `
      import "./a.mjs"; // cycle: keeps b on the DFS stack
      LOG.push("b:before-await");
      globalThis.FLAG = "started";
      await 0;
      LOG.push("b:after-await");
      globalThis.FLAG = "done";
      LOG.push("b:end");
    `,
    "c.mjs": `
      LOG.push("c:throws");
      throw new Error("boom");
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

  const out = JSON.parse(stdout.trim());
  expect({ out, stderr }).toEqual({
    out: {
      log: ["b:before-await", "c:throws", "b:after-await", "b:end", "caught:boom"],
      flag: "done",
    },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// Same scenario, but the suspended body has a try/finally around the await.
// The finally block must run.
test("TLA module in a cycle runs finally after its await when a sibling throws", async () => {
  using dir = tempDir("tla-cycle-sibling-throw-finally", {
    "entry.mjs": `
      globalThis.LOG = [];
      try { await import("./a.mjs"); } catch (e) { LOG.push("caught:" + e.message); }
      await 0; await 0;
      console.log(JSON.stringify(LOG));
    `,
    "a.mjs": `
      import "./b.mjs";
      import "./c.mjs";
    `,
    "b.mjs": `
      import "./a.mjs";
      let ran = false;
      try {
        await 0;
        ran = true;
      } finally {
        LOG.push("b:finally ran=" + ran);
      }
      LOG.push("b:after-finally");
    `,
    "c.mjs": `
      throw new Error("boom");
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

  expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
    out: ["b:finally ran=true", "b:after-finally", "caught:boom"],
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// Multiple awaits in the suspended body: every resume must fire, not just the
// first one.
test("TLA module in a cycle resumes across multiple awaits when a sibling throws", async () => {
  using dir = tempDir("tla-cycle-sibling-throw-multi", {
    "entry.mjs": `
      globalThis.LOG = [];
      try { await import("./a.mjs"); } catch (e) { LOG.push("caught:" + e.message); }
      for (let i = 0; i < 4; i++) await 0;
      console.log(JSON.stringify(LOG));
    `,
    "a.mjs": `
      import "./b.mjs";
      import "./c.mjs";
    `,
    "b.mjs": `
      import "./a.mjs";
      LOG.push("b:0");
      await 0;
      LOG.push("b:1");
      await 0;
      LOG.push("b:2");
    `,
    "c.mjs": `
      throw new Error("boom");
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

  const out = JSON.parse(stdout.trim());
  // b's body must reach every await point; the import() still rejects with c's error.
  expect(out.filter((s: string) => s.startsWith("b:"))).toEqual(["b:0", "b:1", "b:2"]);
  expect(out).toContain("caught:boom");
  expect(stderr).toBe("");
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
