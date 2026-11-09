// A file without `import` and `export` is CommonJS where a name of CommonJS is left behind what `bun run` folds and removes.
// Where the parser of `bun run` has another node in place of the one that is written (the member of a literal for a read out
// of it, an operand for an operator that it decides), it asks that node what it is. Each row is a file of its own, and one
// program requires them all: `require` answers with the namespace of an ES module.
// src/aot/load/format_grid.rs holds the model of the build to the parser for many more rows. This file holds an executable
// to plain Bun.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const rows: ["esm" | "cjs", string][] = [
  // The member has no value that the build knows. `bun run` has it in place of the read.
  ["esm", "if ({ b: function named() {} }.b) {} else module.exports = 1;"],
  ["esm", "if ({ b: class Named {} }.b) {} else module.exports = 1;"],
  ["esm", "var v = { a: function named() {} }.a ?? module.exports;"],
  ["esm", "if ({ b: /x/ }.b) {} else module.exports = 1;"],
  ["esm", "if ([() => {}][0]) {} else module.exports = 1;"],
  ["esm", "if ([function () {}][0]) {} else module.exports = 1;"],
  ["esm", "if ([class {}][0]) {} else module.exports = 1;"],
  ["esm", "if ([typeof absent][0]) {} else module.exports = 1;"],
  ["esm", "if ([new Object()][0]) {} else module.exports = 1;"],
  ["esm", "if ([[() => {}]][0][0]) {} else module.exports = 1;"],
  ["esm", "if ([1, () => {}][1]) {} else module.exports = 1;"],
  ["esm", "if ([...[1, 0]][1]) module.exports = 1;"],
  // What is asked of the member: whether it is null, what `typeof` gives, whether it goes when nothing uses it.
  ["esm", "var v = [[]][0] ?? module.exports;"],
  ["esm", "var v = { a: {} }.a ?? module.exports;"],
  ["esm", "[function () {}][0] || (module.exports = 1);"],
  ["esm", "[class {}][0] ? 1 : (module.exports = 1);"],
  ["esm", "if (![() => {}][0]) module.exports = 1;"],
  ["esm", "if (([function () {}][0] && 1) === 1) {} else module.exports = 1;"],
  ["esm", 'if (typeof [function () {}][0] === "function") {} else module.exports = 1;'],
  ["esm", 'if (typeof [/x/][0] === "object") {} else module.exports = 1;'],
  ["esm", "[function () {}][0], module;"],
  ["esm", "[[]][0], module;"],
  ["esm", "var x; [x][0], module;"],
  ["esm", "[module, () => {}][1];"],
  ["esm", "[[1][0], module];"],
  // The operand in place of an operator that `bun run` decides.
  ["esm", "var v = (true ? () => {} : 0) ?? module.exports;"],
  ["esm", 'if (typeof (0 || function () {}) === "function") {} else module.exports = 1;'],
  ["esm", "if ((0, [0])[0]) module.exports = 1;"],
  ["esm", "if (new Object({ b: 0 }).b) module.exports = 1;"],
  // What `bun run` keeps as it is written.
  ["cjs", "if ({ b() {} }.b) {} else module.exports = 1;"],
  ["cjs", "if ({ b: function named() {}, c: 1 }.b) {} else module.exports = 1;"],
  ["cjs", "if ([...[], () => {}][0]) {} else module.exports = 1;"],
  ["cjs", "const f = [() => {}][0]; if (f) {} else module.exports = 1;"],
  ["cjs", "let i = 0; if ([[0]][i][0]) module.exports = 1;"],
  ["cjs", "if ([{ b: 0 }][0]?.b) module.exports = 1;"],
  ["cjs", 'if ({ k: 0 }["" + "k"]) module.exports = 1;'],
  ["cjs", 'if (([0x0n || "x"][0] && 1) === 1) {} else module.exports = 1;'],
  ["cjs", "var b; var v = [!!(!b || !b)][0] ?? module.exports;"],
];

const ask = `function ask(row, load) {
  const loaded = load();
  console.log(row, Object.prototype.toString.call(loaded) === "[object Module]" ? "esm" : "cjs");
}
`;
const files = {
  "main.cjs": ask + rows.map((_, row) => `ask(${row}, () => require("./row${row}.js"));\n`).join(""),
  ...Object.fromEntries(rows.map(([, source], row) => [`row${row}.js`, source + "\n"])),
};
const expected = {
  stdout: rows.map(([format], row) => `${row} ${format}\n`).join(""),
  stderr: "",
  exitCode: 0,
};

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("plain Bun takes each file for what the table says", async () => {
  using dir = tempDir("in-place-format-plain", files);
  expect(await run([bunExe(), "main.cjs"], String(dir))).toEqual(expected);
});

test.concurrent("an executable takes each file for what plain Bun takes it for", async () => {
  using dir = tempDir("in-place-format-executable", files);
  // One thread: what the table asks does not hang on how the build splits its work.
  const flags = ["--compile", "--aot", "--aot-threads=1"];
  const build = await run([bunExe(), "build", ...flags, "main.cjs", "--outfile", "out"], String(dir));
  expect(build.stderr.split("\n").filter(line => line.startsWith("error"))).toEqual([]);
  expect(build.exitCode).toBe(0);
  expect(await run([join(String(dir), "out")], String(dir))).toEqual(expected);
});
