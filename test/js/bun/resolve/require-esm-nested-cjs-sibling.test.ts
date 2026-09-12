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

async function run(dir: string, entry: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The same gap from an ESM entry: a CJS dependency require()s an ESM module
// the entry also imports. With the CJS import listed first the ESM sibling is
// always still mid-fetch when the require() runs, so this threw every time.
// The package.json without "type" matters: it keeps .cjs on the CommonJS path.
test.concurrent("ESM entry: CJS dependency listed first can require() an ESM sibling of the entry", async () => {
  using dir = tempDir("require-esm-entry-sibling", {
    "package.json": `{"name":"r"}`,
    "p.mjs": `export const a = "a"; export default { m: "D" };`,
    "req.cjs": `globalThis.r = require("./p.mjs");`,
    "main.mjs": `import "./req.cjs";
import d from "./p.mjs";
console.log("ok", globalThis.r.default === d);`,
  });
  const { stdout, stderr, exitCode } = await run(String(dir), "main.mjs");
  expect(stderr).toBe("");
  // One module record: the namespace require() returned is the one import sees.
  expect(stdout).toBe("ok true\n");
  expect(exitCode).toBe(0);
});

// Diamond: entry imports a.mjs (which imports c.mjs) and b.cjs, whose body
// require()s c.mjs while the graph load still has c.mjs mid-fetch. This one
// is timing-dependent on an unfixed build (roughly 4 in 5 runs threw), so run
// a few instances.
test.concurrent("ESM entry: CJS sibling can require() a module another ESM sibling imports", async () => {
  using dir = tempDir("require-esm-diamond", {
    "package.json": `{"name":"r"}`,
    "c.mjs": `globalThis.t ??= []; globalThis.t.push("C"); export const c = 1;`,
    "a.mjs": `import "./c.mjs"; globalThis.t.push("A"); export const a = 1;`,
    "b.cjs": `(globalThis.t ??= []).push("B"); try { require("./c.mjs"); globalThis.t.push("B-req-ok") } catch (e) { globalThis.t.push("B-req-ERR") } module.exports = {};`,
    "entry.mjs": `import "./a.mjs";
import "./b.cjs";
console.log(globalThis.t.join(" "));`,
  });
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      const { stdout, stderr, exitCode } = await run(String(dir), "entry.mjs");
      expect(stderr).toBe("");
      // Every module evaluates exactly once and the require() succeeds. (The
      // relative order of b.cjs vs the ESM siblings is not what this asserts.)
      expect(stdout.trim().split(" ").toSorted()).toEqual(["A", "B", "B-req-ok", "C"]);
      expect(exitCode).toBe(0);
    }),
  );
});

// Siblings with top-level await in the same graph must not make the require()
// of a sibling *without* TLA fail: k.cjs require()s s.mjs (sync) while p1/p2
// depend on t.mjs (TLA). Also timing-dependent on an unfixed build.
test.concurrent("ESM entry with TLA siblings: CJS sibling can require() a non-TLA ESM sibling", async () => {
  using dir = tempDir("require-esm-tla-siblings", {
    "package.json": `{"name":"r"}`,
    "t.mjs": `await 0; (globalThis.t ??= []).push("T"); export const t = 1;`,
    "p1.mjs": `import "./t.mjs"; (globalThis.t ??= []).push("P1"); export const p1 = 1;`,
    "p2.mjs": `import "./t.mjs"; (globalThis.t ??= []).push("P2"); export const p2 = 1;`,
    "s.mjs": `(globalThis.t ??= []).push("S"); export const s = 1;`,
    "k.cjs": `(globalThis.t ??= []).push("K"); try { require("./s.mjs"); globalThis.t.push("K-req-ok") } catch (e) { globalThis.t.push("K-req-ERR") } module.exports = {};`,
    "entry.mjs": `import "./p1.mjs";
import "./p2.mjs";
import "./s.mjs";
import "./k.cjs";
console.log(globalThis.t.join(" "));`,
  });
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      const { stdout, stderr, exitCode } = await run(String(dir), "entry.mjs");
      expect(stderr).toBe("");
      expect(stdout.trim().split(" ").toSorted()).toEqual(["K", "K-req-ok", "P1", "P2", "S", "T"]);
      expect(exitCode).toBe(0);
    }),
  );
});
