// A function that calls itself lays its own answer into a list or a record: `return n ? [make(n - 1)] : (table = { a: "./a.cjs" })`. What is born there lies at every depth below the
// answer. The build asks who takes what is born, one question for each place and depth. Through a method of a written object the depth grew with every round and the build died of an
// overflow of its stack. Through a declared function the second round was taken for the first, so whoever reached down two layers and changed the name was never asked: the build said
// nothing and the executable threw. Where the walk comes round to a place or a function whose own question is still open, with what is born lying deeper, nobody can be asked: the
// build warns (TS100064) and the name is made at the run.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const born = `(table = { a: "./a.cjs" })`;
const makers = {
  "a method, one return": `const o = { make(n) { return n ? [o.make(n - 1)] : ${born}; } }; const make = n => o.make(n);`,
  "a method, a record": `const o = { make(n) { return n ? { 0: o.make(n - 1) } : ${born}; } }; const make = n => o.make(n);`,
  "a declared function, one return": `function make(n) { return n ? [make(n - 1)] : ${born}; }`,
  "a declared function, two returns": `function make(n) { if (n) return [make(n - 1)]; return ${born}; }`,
  "two functions": `function make(n) { if (n) return [other(n - 1)]; return ${born}; } function other(n) { return make(n); }`,
};

for (const [form, maker] of Object.entries(makers)) {
  test(form, async () => {
    using dir = tempDir("what-a-function-that-calls-itself-wraps", {
      "main.cjs": `let table = null;\n${maker}\nmake(1)[0].a = "./b" + ".cjs";\nconsole.log("SAID", require(table.a));\n`,
      "a.cjs": `module.exports = "a";\n`,
      "b.cjs": `module.exports = "b";\n`,
    });
    const cwd = String(dir);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.cjs", "b.cjs", "--outfile", "out/program"],
      cwd,
    );
    expect({ warns: built.stderr.includes("TS100064"), exitCode: built.exitCode }).toEqual({
      warns: true,
      exitCode: 0,
    });
    for (const file of ["a.cjs", "b.cjs"]) rmSync(join(cwd, file));
    expect(await run([join(cwd, "out", "program")], join(cwd, "out"))).toEqual({
      stdout: "SAID b\n",
      stderr: "",
      exitCode: 0,
    });
  });
}
