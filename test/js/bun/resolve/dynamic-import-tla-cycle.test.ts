import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A top-level-awaited dynamic import whose target statically imports the
// awaiting module back. Per ECMA-262 InnerModuleEvaluation step 12.b.v, the
// chunk waits on the entry (an EvaluatingAsync dependency); the entry is
// itself waiting on the chunk via the dynamic import, so the graph deadlocks.
// Node detects the unsettled top-level await and exits 13. Previously Bun
// skipped the wait and let the chunk observe the entry's half-initialised
// bindings (TDZ for post-await `const`, `undefined` for post-await `var`).
test("dynamic import inside TLA whose target imports the awaiter back is an unsettled TLA (exit 13)", async () => {
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

  // The chunk never evaluates: it is waiting on index.mjs, which is waiting on it.
  expect(stdout).toBe("");
  expect(stderr).toContain("Detected unsettled top-level await");
  expect(stderr).toContain("index.mjs");
  expect(exitCode).toBe(13);
});

// Same pattern with the awaiting module reached via a static import. The
// chunk statically imports `mid.mjs` while it is EvaluatingAsync, so it waits;
// `mid.mjs` is awaiting the chunk's evaluate() promise. Deadlock, exit 13.
test("dynamic import inside TLA of a non-entry module whose target imports it back is an unsettled TLA (exit 13)", async () => {
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

  expect(stdout).toBe("");
  expect(stderr).toContain("Detected unsettled top-level await");
  expect(stderr).toContain("mid.mjs");
  expect(exitCode).toBe(13);
});

// The observable failure mode of the old deadlock-skip: `b` runs while `a` is
// suspended mid-TLA and reads `a`'s post-await bindings in TDZ / as undefined.
// Per spec `b` must wait on `a` (deadlock); it must never observe partial state.
test("dynamic-import cycle does not let the importee observe the awaiter's half-initialised bindings", async () => {
  using dir = tempDir("dyn-tla-cycle-partial", {
    "entry.mjs": `import "./a.mjs"; console.log("entry:done");`,
    "a.mjs": `
      export const PRE = "pre";
      const b = await import("./b.mjs");
      console.log("a got:", b.report);
      export const POST = "post";
      export var V = "v";
    `,
    "b.mjs": `
      import { PRE, POST, V } from "./a.mjs";
      const r = f => { try { return String(f()) } catch (e) { return "threw:" + e.constructor.name } };
      export const report = \`PRE=\${r(()=>PRE)} POST=\${r(()=>POST)} V=\${r(()=>V)}\`;
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

  // b never runs (it is waiting on a), so a's `await` never resolves and entry
  // never completes. No partial-state observation leaks to stdout.
  expect(stdout).not.toContain("threw:ReferenceError");
  expect(stdout).not.toContain("V=undefined");
  expect(stdout).toBe("");
  expect(stderr).toContain("Detected unsettled top-level await");
  expect(stderr).toContain("a.mjs");
  expect(exitCode).toBe(13);
});

// Mutual `await import()` at top level: both suspend on each other. Per spec
// this deadlocks; both Node and Bun exit 13. Distinct from the one-sided case
// above (only one side is a dynamic import).
test("mutual top-level await import() cycle is an unsettled TLA (exit 13)", async () => {
  using dir = tempDir("dyn-tla-mutual", {
    "a.mjs": `console.log("a:start"); await import("./b.mjs"); console.log("a:done");`,
    "b.mjs": `console.log("b:start"); await import("./a.mjs"); console.log("b:done");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "a.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("a:start\nb:start\n");
  expect(stderr).toContain("Detected unsettled top-level await");
  expect(exitCode).toBe(13);
});

// Sibling static imports in the same Evaluate() pass must wait on an
// EvaluatingAsync SCC (step 12.b.v). Here `entry` first imports `a` (in an SCC
// {a,c} with an async dep), popping the SCC to EvaluatingAsync, then imports
// `b` which reads a binding from `c`. `b` must wait for the SCC. Regression
// guard for a prior loader version that skipped the wait and ran `b` with
// `c`'s bindings in TDZ; Node waits here.
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

// #30259: a TLA dep (pendingAsyncDependencies == 0) suspended earlier in the
// same Evaluate() is re-imported by a sibling. The sibling must wait on it per
// step 12.b.v. Regression guard for a prior loader version that skipped the
// wait and ran `child` with `foo` still in TDZ.
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
// (so neither parent is on the DFS stack when the second one visits it).
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
