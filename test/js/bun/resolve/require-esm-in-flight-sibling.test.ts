// A CommonJS module imported by an ESM graph has its body evaluated while the
// graph is still loading (during the loader's makeModule step). That body can
// require() an ESM sibling the graph already started fetching on the
// transpiler thread, so the sibling's registry entry is mid-fetch: status
// Fetching with a pending fetch promise. require(esm)'s synchronous load used
// to leave that pending promise untouched and threw a spurious
// `require() async module "..." is unsupported. use "await import()" instead.`
// TypeError even though the sibling has no top-level await.
//
// e.mjs is padded with exports so its transpile reliably loses the race to
// d.cjs's require(). The race is probabilistic per run; concurrent runs make
// an unfixed bun fail with near certainty.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("require() of an ESM sibling that is still transpiling completes synchronously", async () => {
  const pad = Array.from({ length: 3000 }, (_, i) => `export const pad${i} = ${i};`).join("\n");
  using dir = tempDir("require-esm-in-flight", {
    "entry.mjs": `import "./a.mjs";
import "./c.mjs";
console.log((globalThis.o ??= []).concat("entry").join(","));`,
    "a.mjs": `import "./b.cjs";
(globalThis.o ??= []).push("a");
export const a = 1;`,
    "b.cjs": `require("./c.mjs");
(globalThis.o ??= []).push("b");
module.exports = {};`,
    "c.mjs": `import "./d.cjs";
import "./e.mjs";
(globalThis.o ??= []).push("c");
export const c = 1;`,
    "d.cjs": `require("./e.mjs");
(globalThis.o ??= []).push("d");
module.exports = {};`,
    "e.mjs": `(globalThis.o ??= []).push("e");
export const e = 1;
${pad}`,
  });

  await Promise.all(
    Array.from({ length: 12 }, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("e,d,c,b,a,entry\n");
      expect(exitCode).toBe(0);
    }),
  );
  // 12 subprocess spawns under a debug/ASAN build need more than the 5s default.
}, 30_000);
