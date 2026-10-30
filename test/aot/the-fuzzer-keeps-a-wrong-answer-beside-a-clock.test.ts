// fuzz/accepted-differences.tsv holds lines for programs whose output hangs on a clock, chance, a process number, a drawn folder or the whole global object. Such a line counts a finding and does not keep it.
// A program that only uses these things, and prints something else wrongly, is kept.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const lines = readFileSync(join(import.meta.dir, "fuzz", "accepted-differences.tsv"), "utf8")
  .split("\n")
  .filter(line => line !== "" && !line.startsWith("#"))
  .map(line => line.split("\t"))
  .filter(([, , , where]) => where === "both")
  .map(([pattern]) => new RegExp(pattern));
const isAccepted = (plain: string, compiled: string, program: string) =>
  lines.some(line =>
    line.test(
      `product default different output plain ${JSON.stringify(plain)} compiled ${JSON.stringify(compiled)}\n${program}`,
    ),
  );

const uses = [
  `const folder = mkdtempSync(join(tmpdir(), "x-"));\nwriteFileSync(join(folder, "a.js"), "");`,
  `const own = process.pid;`,
  `const began = new Date().getTime();`,
  `const size = statSync(path).size;`,
  `const id = crypto.randomUUID();`,
  `(function (root) {\n  root.seen = 1;\n})(globalThis);`,
  `run.call(globalThis, 1);`,
  `const root = globalThis;`,
  `use(process);`,
];

test.each(uses)("a wrong answer is kept beside %j", use => {
  expect(isAccepted("0 made 2,3,4 5,6,7", "0 made 2,2,2 3,3,3", `${use}\nconsole.log("0 made", made.join());\n`)).toBe(
    false,
  );
  expect(isAccepted("yes", "no", `${use}\nconsole.log(answer);\n`)).toBe(false);
});

test.each([
  ["pid 48211", "pid 48377", `console.log("pid", process.pid);`],
  ["at 1792857600123", "at 1792857600125", `console.log("at", new Date().getTime());`],
  ["in /tmp/x-Ab3dEf", "in /tmp/x-Zk9qLm", `console.log("in", mkdtempSync(join(tmpdir(), "x-")));`],
  ["id 3f2b8c1e-aaaa", "id 9d4e7a60-bbbb", `console.log("id", crypto.randomUUID());`],
  ["descriptor 12", "descriptor 14", `console.log("descriptor", openSync(path, "r"));`],
  ["gone true", "gone false", `console.log("gone", new WeakRef(thing).deref() === undefined);`],
  ["title,version", "version,title", `console.log(Object.keys(process).join());`],
  ["{ a: 1 }", "{ b: 1 }", `console.log(globalThis);`],
  ["a", "b", `for (const key in globalThis) console.log(key);`],
  ["a", "b", `console.log(Object.keys({ ...process }).join());`],
])("%j against %j is accepted", (plain, compiled, program) => {
  expect(isAccepted(plain, compiled, program + "\n")).toBe(true);
});
