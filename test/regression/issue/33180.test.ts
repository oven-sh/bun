// https://github.com/oven-sh/bun/issues/33180
//
// A CommonJS module imported by an ESM graph has its body run while the graph
// is still loading. If that body require()s a plain ESM module (no top-level
// await) that the same graph is also importing, the module's registry entry is
// still mid-fetch, and 1.3.14 misreported it as
//   TypeError: require() async module "..." is unsupported. use "await import()" instead.
// 1.3.11 and Node both load it synchronously.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("require() of an ESM module the surrounding import graph is still fetching", async () => {
  // Deterministic: starter.cjs is a one-line module, so its body runs as soon
  // as it is delivered, before a.cjs and b.mjs have finished fetching, on
  // every run. b.mjs importing a.cjs back while a.cjs is still evaluating
  // additionally checks that the synchronous load hands the ESM side the live
  // exports of the half-evaluated CJS module and does not run it twice. Node
  // prints the same JSON.
  using dir = tempDir("issue-33180-cycle", {
    "entry.mjs": `
      import "./starter.cjs";
      import a from "./a.cjs";
      import { lateViaESM } from "./b.mjs";
      console.log(JSON.stringify({ evaluations: globalThis.evaluations, late: a.late, lateViaESM: lateViaESM() }));
    `,
    "starter.cjs": `require("./a.cjs");`,
    "a.cjs": `
      globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
      exports.early = "early";
      require("./b.mjs");
      exports.late = "late";
    `,
    "b.mjs": `
      import a from "./a.cjs";
      export function lateViaESM() { return a.late; }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ evaluations: 1, late: "late", lateViaESM: "late" }) + "\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("consecutive require()s of several ESM siblings that are still transpiling", async () => {
  // The shape from the issue: the siblings are large so their transpile on the
  // transpiler thread is still in flight when the tiny CJS module's body runs
  // and require()s each of them in turn.
  const files: Record<string, string> = {
    "entry.mjs": `
      import "./e1.mjs";
      import "./e2.mjs";
      import "./e3.mjs";
      import "./e4.mjs";
      import "./k.cjs";
      console.log("entry-done");
    `,
    "k.cjs": `
      const ids = [1, 2, 3, 4].map(i => require("./e" + i + ".mjs").id);
      console.log("required " + JSON.stringify(ids));
      module.exports = {};
    `,
  };
  for (let i = 1; i <= 4; i++) {
    let source = "";
    for (let j = 0; j < 500; j++) source += `export const v${j} = ${j};\n`;
    files[`e${i}.mjs`] = source + `export const id = ${i};\n`;
  }
  using dir = tempDir("issue-33180-siblings", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "required [1,2,3,4]\nentry-done\n",
    stderr: "",
    exitCode: 0,
  });
});
