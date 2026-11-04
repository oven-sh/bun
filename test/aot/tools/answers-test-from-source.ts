// Makes an IR text test that runs (WebKit's aot/tests/answers, or ../engine-tests/answers) from a small program: the shortest way from a program that once gave a
// wrong answer to a test of the engine that holds the right one.
//
//   bun test/aot/tools/answers-test-from-source.ts main.js [--without-library] "<what the program is about>" > main.ir       needs testaot, as ./ir-test-from-source.ts
//
// The program is one file without imports. It tells each answer by `report(value)`, a number, a text, a boolean, undefined or null, and ends with `report("end")`.
// It may await: whatever it still waits for when it reports "end" tells nothing.
// `report` is the only free name: everything else the program makes itself, so that the flow analysis knows as much about it as about a whole application.
// The test holds no answer that somebody wrote down: when "end" arrives the shell runs the text of the program itself, types erased, and compares answer by answer.
// One statement or declaration a line, and no `//` comment: the lines are joined.
//
// --without-library: the records of the program's own file alone, for aot/tests/answers. Then every built-in that is written in JavaScript returns undefined, in
// the compiled program and in the shell's own run alike: a program that needs one goes to ../engine-tests/answers with the library functions that it reaches.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { recordsOfSource } from "./ir-test-from-source";

const withoutTypes = (line: string) =>
  new Bun.Transpiler({ loader: "ts", deadCodeElimination: false })
    .transformSync(line)
    .split("\n")
    .map(part => part.trim())
    .join(" ")
    .trim();

function ownRecordsOf(text: string[]) {
  const kept: string[] = [];
  let isInOwnFunction = false;
  for (const line of text) {
    if (line.startsWith("runtimefunction ") || (line.startsWith("module ") && /IsLibrary|kind=Runtime/.test(line)))
      continue;
    if (line.startsWith("function ")) isInOwnFunction = / module=m0\b/.test(line) && !/ role=Signature\b/.test(line);
    if (/^(function | |\})/.test(line) && !isInOwnFunction) continue;
    kept.push(
      line.startsWith("layout ")
        ? line.replace(/ module=m[1-9]\d*/, "")
        : line.replace(/ functionTypes=\[[^\]]*\]/, ""),
    );
  }
  return kept;
}

const operands = process.argv.slice(2);
const isWithoutLibrary = operands.includes("--without-library");
const [source, ...sentences] = operands.filter(operand => operand !== "--without-library");
if (!source) {
  console.error(
    'usage: bun test/aot/tools/answers-test-from-source.ts <source file> [--without-library] "<what the program is about>"',
  );
  process.exit(2);
}
const lines = readFileSync(source, "utf8").trimEnd().split("\n");
const written = lines.filter(line => line.trim() && !line.startsWith("declare "));
const erased = /\.[cm]?ts$/.test(source) ? written.map(withoutTypes).filter(line => line) : written;
// A run of the text here counts the answers: a function that reports may be called more than once.
let answers = 0;
const AsyncFunction = (async () => {}).constructor as FunctionConstructor;
await new AsyncFunction("report", `"use strict"; ${erased.join(" ")}`)(() => void answers++);
const { text, unknownIDs } = recordsOfSource(source);
const shell = [
  `(function () { "use strict";`,
  `const show = value => typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);`,
  `const twin = async report => { ${erased.join(" ")} };`,
  `const got = [];`,
  `globalThis.report = value => { got.push(show(value)); if (value !== "end") return;`,
  `const expected = []; twin(value => { expected.push(show(value)); if (value !== "end") return; let same = 0;`,
  `for (let n = 0; n < expected.length; n++) { if (got[n] === expected[n]) same++; else print("answer " + n + ": " + String(got[n]).slice(0, 90) + " and not " + expected[n].slice(0, 90)); }`,
  `print(same + " of " + expected.length + " of " + got.length); }); }; })();`,
].join(" ");
console.log(
  [
    // With these two marks ./update-ir-tests.ts writes the records anew, so that they do not go stale against the front end and the table of built-ins.
    ...(isWithoutLibrary
      ? written.map(line => `# ${line}`)
      : [`# -- source: ${basename(source)}`, ...lines.map(line => `# ${line}`.trimEnd()), "# -- end of source"]),
    ...sentences.map(sentence => `# ${sentence}`),
    "# At the end the shell runs the same text itself: every answer is the same.",
    "# FORM: AsRead",
    `# RUN: run-in-shell ${shell}`,
    `# CHECK: ${answers} of ${answers} of ${answers}`,
    "# CHECK-NEXT: exited with 0",
    "",
    ...(isWithoutLibrary ? ownRecordsOf(text) : text),
  ].join("\n"),
);
if (unknownIDs.size) console.error(`these name no record: ${[...unknownIDs].join(" ")}`);
