import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

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

// a.mjs and t.mjs are one import cycle, so t.mjs is still on the stack of
// Evaluate(), suspended at its await, when x.mjs throws. Evaluate() gives every
// module on the stack that error, but the body of t.mjs has started: it runs to
// its end like the body of an async function, as in Node.
const suspendedCycleMember = {
  "a.mjs": `
    import "./t.mjs";
    import "./x.mjs";
    console.log("a");
  `,
  "t.mjs": `
    import "./a.mjs";
    console.log("t1");
    try {
      await 0;
      console.log("t2 (after the await)");
    } finally {
      console.log("t finally");
    }
  `,
  "x.mjs": `
    console.log("x");
    throw new Error("from x");
  `,
  "main.mjs": `
    await import("./a.mjs").catch(e => console.log("rejected:", e.message));
    console.log("done");
  `,
};

test.concurrent("a cycle member suspended at a top-level await continues when a later import throws", async () => {
  using dir = tempDir("tla-cycle-suspended-member", suspendedCycleMember);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.split("\n"), stderr }).toEqual({
    stdout: ["t1", "x", "t2 (after the await)", "t finally", "rejected: from x", "done", ""],
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("a cycle member suspended at a top-level await continues when the entry point fails", async () => {
  using dir = tempDir("tla-cycle-suspended-member-entry", suspendedCycleMember);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "a.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.split("\n")).toEqual(["t1", "x", "t2 (after the await)", "t finally", ""]);
  expect(stderr).toContain("error: from x");
  expect(exitCode).toBe(1);
});

test.concurrent("a cycle member suspended at a top-level await resumes every time", async () => {
  // a.mjs imports suspended.mjs, which imports a.mjs back, and then throws.mjs.
  const graph = (name: string, suspended: string) => ({
    [`${name}/a.mjs`]: `
      import "./suspended.mjs";
      import "./throws.mjs";
      log.push("a");
    `,
    [`${name}/suspended.mjs`]: `
      import "./a.mjs";
      log.push("suspended: start");
      ${suspended}
    `,
    [`${name}/throws.mjs`]: `
      log.push("throws");
      throw new Error("${name}/throws.mjs");
    `,
  });
  using dir = tempDir("tla-cycle-suspended-member-resumes", {
    ...graph(
      "awaits",
      `for (let i = 1; i <= 3; i++) {
        await 0;
        log.push("suspended: " + i);
      }`,
    ),
    ...graph(
      "rejected-await",
      `try {
        await Promise.reject(new Error("rejected"));
      } catch (e) {
        log.push("suspended: caught " + e.message);
      }`,
    ),
    ...graph(
      "for-await",
      `async function* values() {
        yield 1;
        yield 2;
      }
      try {
        for await (const value of values()) log.push("suspended: " + value);
      } finally {
        log.push("suspended: finally");
      }`,
    ),
    // The module already has the error of throws.mjs: its own goes nowhere.
    ...graph(
      "late-throw",
      `await 0;
      log.push("suspended: after the await");
      throw new Error("late-throw/suspended.mjs");`,
    ),
    // waits.mjs depends on suspended.mjs, so its body has not started when
    // throws.mjs throws. It never does.
    ...graph(
      "not-started",
      `await 0;
      log.push("suspended: end");`,
    ),
    "not-started/a.mjs": `
      import "./waits.mjs";
      import "./throws.mjs";
      log.push("a");
    `,
    "not-started/waits.mjs": `
      import "./suspended.mjs";
      log.push("waits: start");
      await 0;
      log.push("waits: end");
    `,
    "entry.mjs": `
      const output = {};
      process.on("unhandledRejection", error => {
        output.unhandledRejection = error.message;
      });
      const settle = promise => promise.then(() => "fulfilled", error => "rejected: " + error.message);
      // Every suspended body needs only jobs to reach its end: they have all run when a task runs.
      const jobsDone = () => new Promise(resolve => setImmediate(resolve));
      for (const name of ["awaits", "rejected-await", "for-await", "late-throw", "not-started"]) {
        globalThis.log = [];
        const result = await settle(import("./" + name + "/a.mjs"));
        await jobsDone();
        output[name] = { result, log };
      }
      output.reimport = await settle(import("./late-throw/suspended.mjs"));
      await jobsDone();
      console.log(JSON.stringify(output));
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

  expect({ stdout: stdout.trim() && JSON.parse(stdout), stderr }).toEqual({
    stdout: {
      "awaits": {
        result: "rejected: awaits/throws.mjs",
        log: ["suspended: start", "throws", "suspended: 1", "suspended: 2", "suspended: 3"],
      },
      "rejected-await": {
        result: "rejected: rejected-await/throws.mjs",
        log: ["suspended: start", "throws", "suspended: caught rejected"],
      },
      "for-await": {
        result: "rejected: for-await/throws.mjs",
        log: ["suspended: start", "throws", "suspended: 1", "suspended: 2", "suspended: finally"],
      },
      "late-throw": {
        result: "rejected: late-throw/throws.mjs",
        log: ["suspended: start", "throws", "suspended: after the await"],
      },
      "not-started": {
        result: "rejected: not-started/throws.mjs",
        log: ["suspended: start", "throws", "suspended: end"],
      },
      reimport: "rejected: late-throw/throws.mjs",
    },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// The same through Bun.ModuleGraph, which loads the files another time with a
// module loader of its own. `who`, `gate` and the functions are the graph's
// `globals`. a.mjs imports suspended.mjs, which imports a.mjs back and waits
// for `gate`, and then throws.mjs.
const suspendedCycleMemberOfAGraph = (suspended: string) => ({
  "a.mjs": `import { state } from "./suspended.mjs"; import "./throws.mjs"; export { state };`,
  "suspended.mjs": `import "./a.mjs"; export let state = who + ": suspended"; suspendedAtItsAwait(who); ${suspended}`,
  "throws.mjs": `if (siblingThrows) throw new Error(who + ": the sibling throws");`,
});
// More turns of the event loop than a 0 ms timer and an import() of one file need.
const turns = async () => {
  for (let i = 0; i < 50; i++) await new Promise<void>(resolve => setImmediate(resolve));
};
const settle = (promise: Promise<unknown>) =>
  promise.then(
    () => "fulfilled",
    error => "rejected: " + error.message,
  );

test("Bun.ModuleGraph: a suspended cycle member runs to its end after dispose(), and what it starts then does not start", async () => {
  using dir = tempDir("tla-cycle-suspended-member-graph", {
    ...suspendedCycleMemberOfAGraph(`
      state = who + ": resumed with " + (await gate) + (Bun.ModuleGraph.current === graph() ? " in its graph" : "");
      import("./late.mjs").then(() => note("import() settled"), () => note("import() settled"));
      setTimeout(() => note("timer fired"), 0);
      ranToItsEnd(state);
      throw new Error("thrown after the await");`),
    "late.mjs": `note("late.mjs ran");`,
  });
  const gate = Promise.withResolvers<string>();
  const seen = { ended: [] as string[], notes: [] as string[], errors: [] as string[] };
  const graph: Bun.ModuleGraph = new Bun.ModuleGraph({
    onError: (error: any) => seen.errors.push(error.message),
    globals: {
      who: "g",
      siblingThrows: true,
      gate: gate.promise,
      graph: () => graph,
      suspendedAtItsAwait: () => {},
      ranToItsEnd: (state: string) => seen.ended.push(state),
      note: (what: string) => seen.notes.push(what),
    },
  });
  expect(await settle(graph.import(join(String(dir), "a.mjs")))).toBe("rejected: g: the sibling throws");
  graph.dispose();
  gate.resolve("the gate");
  await turns();
  // The error that the body throws at its end is nobody's: the module has the error of throws.mjs.
  expect(seen).toEqual({ ended: ["g: resumed with the gate in its graph"], notes: [], errors: [] });
});

test("Bun.ModuleGraph: a second graph loads the files while the first graph's failed member is suspended, and each body ends with its own state", async () => {
  using dir = tempDir(
    "tla-cycle-suspended-member-graphs",
    suspendedCycleMemberOfAGraph(`state = who + ": resumed with " + (await gate); ranToItsEnd(state);`),
  );
  for (const order of [
    ["failed", "second"],
    ["second", "failed"],
  ]) {
    const gates: Record<string, PromiseWithResolvers<string>> = {
      failed: Promise.withResolvers(),
      second: Promise.withResolvers(),
    };
    const suspended: string[] = [];
    const ended: string[] = [];
    const graph = (who: string) =>
      new Bun.ModuleGraph({
        globals: {
          who,
          siblingThrows: who === "failed",
          gate: gates[who].promise,
          suspendedAtItsAwait: (who: string) => suspended.push(who),
          ranToItsEnd: (state: string) => ended.push(state),
        },
      });
    using failed = graph("failed");
    using second = graph("second");
    expect(await settle(failed.import(join(String(dir), "a.mjs")))).toBe("rejected: failed: the sibling throws");
    const imported = second.import(join(String(dir), "a.mjs"));
    while (suspended.length < 2) await new Promise<void>(resolve => setImmediate(resolve));
    for (const who of order) {
      gates[who].resolve("its gate");
      await turns();
    }
    expect({ ended, state: (await imported).state }).toEqual({
      ended: order.map(who => `${who}: resumed with its gate`),
      state: "second: resumed with its gate",
    });
  }
});
