// When a CommonJS entry require()s an ESM graph, the whole graph loads on the
// loader's synchronous module queue. A CJS module inside that graph has its
// body evaluated mid-load, and that body can require() an ESM sibling whose
// registry entry is mid-fetch: the reactions that would settle it sit on the
// *outer* drain's queue, which the nested synchronous load cannot reach.
//
// That used to have two faces:
// 1. require() of the in-flight sibling threw a spurious
//    `require() async module "..." is unsupported` TypeError even though the
//    sibling has no top-level await.
// 2. The TypeError aborted the CJS module's body, which evicted it from the
//    require cache; a replayed makeModule then found no cache entry and
//    silently produced an *empty* module, so the CJS module's top-level code
//    never ran at all: no throw, exit 0, one module of the graph skipped.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const graph = {
  "main.cjs": `require("./a.mjs");`,
  "a.mjs": `import "./b.mjs";
import "./d.mjs";
import "./e.mjs";
(globalThis.T ??= []).push("a");
console.log("N=" + globalThis.T.length + " " + globalThis.T.join(","));`,
  "b.mjs": `import "./c.cjs";
(globalThis.T ??= []).push("b");`,
  "c.cjs": `require("./e.mjs");
(globalThis.T ??= []).push("c");`,
  "d.mjs": `import "./f.cjs";
(globalThis.T ??= []).push("d");`,
  "e.mjs": `import "./f.cjs";
import "./h.mjs";
(globalThis.T ??= []).push("e");`,
  "f.cjs": `require("./h.mjs");
(globalThis.T ??= []).push("f");
console.log("f.cjs evaluated");`,
  "h.mjs": `(globalThis.T ??= []).push("h");`,
};

test.concurrent("require() of an ESM entry evaluates every CommonJS module in the graph", async () => {
  using dir = tempDir("require-esm-nested-cjs", graph);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // Same evaluation order Node prints. Before the fix, f.cjs was silently
  // skipped: "N=6 h,e,c,b,d,a" and no "f.cjs evaluated" line.
  expect(stdout).toBe("f.cjs evaluated\nN=7 h,f,e,c,b,d,a\n");
  expect(exitCode).toBe(0);
});

test.concurrent("a CommonJS module throwing inside a require()d ESM graph surfaces the error", async () => {
  using dir = tempDir("require-esm-nested-cjs-throw", {
    ...graph,
    "f.cjs": `require("./h.mjs");
throw new Error("boom from f.cjs");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Before the fix this printed "N=6 h,e,c,b,d,a" and exited 0: the throw was
  // swallowed along with the module.
  expect(stderr).toContain("boom from f.cjs");
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});

test.concurrent(
  "a caught require() of a throwing CJS sibling still fails its import edge with the original error",
  async () => {
    using dir = tempDir("require-esm-nested-cjs-caught", {
      "main.cjs": `require("./a.mjs");`,
      "a.mjs": `import "./e.mjs";
console.log("a evaluated");`,
      "e.mjs": `import "./g.cjs";
import "./f.cjs";`,
      // g.cjs evaluates f.cjs first (both are in the require cache before either
      // runs) and swallows the throw; the import edge of f.cjs must still reject
      // with f's real error, not succeed with an empty module.
      "g.cjs": `try { require("./f.cjs"); } catch {}`,
      "f.cjs": `throw new Error("boom from f.cjs");`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Before the fix: "a evaluated" and exit 0, with f.cjs silently skipped.
    expect(stderr).toContain("boom from f.cjs");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  },
);
