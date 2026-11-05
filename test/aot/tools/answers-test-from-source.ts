// Makes an IR text test that runs (WebKit's aot/tests/answers) from a small program: the shortest way from a program that once gave a
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
//   bun test/aot/tools/answers-test-from-source.ts main.ts --without-library --store "<what it is about>" > ../answers/main.ts     a new test: then write its RUN(X) and X: lines into the head
//   bun test/aot/tools/answers-test-from-source.ts --stored ../answers/<case>.ts > <case>.ir      what ../engine/answers.ts does with every file of ../answers
//
// ../answers holds such tests WITHOUT their records: the records are what today's front end writes for the program, so they are made when the test runs. A file there:
//   line 1              `// answers: without-library` or `// answers: with-library`
//   lines `// # ..`     the head of the test, line by line: what it is about, RUN and check lines. `$SHELL` stands for the text that the shell runs.
//                       `# f1 = sum, f2 = Box`: the legend: where the records number those functions otherwise, the f<n> of the RUN and check lines follow.
//   the rest            the program
//
// --without-library: the records of the program's own file alone. Then every built-in that is written in JavaScript returns undefined, in
// the compiled program and in the shell's own run alike, and run-in-shell fails the run in which one is called: a program that needs one goes to ../parallel.
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { recordsOfSource } from "./ir-test-from-source";

// The printer writes a text that holds a line break as a template with the break in it. Joined by a blank it would be another text than the program's.
const endsInsideTemplate = (part: string, startsInside: boolean) =>
  (part.replace(/\\./g, "").split("`").length - 1) % 2 === 1 ? !startsInside : startsInside;

function withoutTypes(line: string) {
  let joined = "";
  let isInsideTemplate = false;
  for (const part of new Bun.Transpiler({ loader: "ts", deadCodeElimination: false }).transformSync(line).split("\n")) {
    joined += isInsideTemplate ? "\\n" + part : " " + part.trim();
    isInsideTemplate = endsInsideTemplate(part, isInsideTemplate);
  }
  return joined.trim();
}

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

/** What the tool makes of a program: the text for the shell, how many answers it reports, and the records. */
async function partsOf(source: string, isWithoutLibrary: boolean, countsAnswers = true) {
  const lines = readFileSync(source, "utf8").trimEnd().split("\n");
  const written = lines.filter(line => line.trim() && !line.startsWith("declare "));
  const erased = /\.[cm]?ts$/.test(source) ? written.map(withoutTypes).filter(line => line) : written;
  // A run of the text here counts the answers: a function that reports may be called more than once.
  let answers = 0;
  const AsyncFunction = (async () => {}).constructor as FunctionConstructor;
  if (countsAnswers) await new AsyncFunction("report", `"use strict"; ${erased.join(" ")}`)(() => void answers++);
  const { text, unknownIDs } = recordsOfSource(source, !isWithoutLibrary);
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
  const records = (isWithoutLibrary ? ownRecordsOf(text) : text).map(withoutInheritedFieldsAlone);
  return { lines, written, shell, answers, records, unknownIDs };
}

// `testaot print` lists the fields that a layout inherits, and leaves ownFieldCount out where it is 0. Read back, a layout without the word owns all that it lists.
// Such a layout is written as the wire has it, without the inherited fields: the reader appends them itself.
function withoutInheritedFieldsAlone(line: string) {
  const start = line.indexOf(" fields=[");
  if (!line.startsWith("layout ") || !line.includes("IsInherited") || line.includes(" ownFieldCount=") || start < 0) return line;
  let depth = 0;
  for (let end = start + " fields=".length; ; end++) {
    if (line[end] === "[") depth++;
    if (line[end] === "]" && !--depth) return line.slice(0, start) + line.slice(end + 1);
  }
}

const isDirective = (line: string) => /^# (RUN(\([A-Z0-9]+\))?|[A-Z][A-Z0-9]*(-[A-Z0-9-]+)?):/.test(line);
const isLegend = (line: string) => /^# f\d+ = /.test(line);

/** `# f1 = sum, f2 = Box`: where the records give those functions other numbers, the numbers in the RUN and check lines and in the legend follow. */
function numberedByLegend(head: string[], records: string[]) {
  const numbersOf = new Map<string, string[]>();
  for (const line of records) {
    const [, number, name] = /^function (f\d+) name="((?:[^"\\]|\\.)*)"/.exec(line) ?? [];
    if (number) numbersOf.set(name, [...(numbersOf.get(name) ?? []), number]);
  }
  const renumbered = new Map<string, string>();
  for (const line of head.filter(isLegend))
    for (const [, number, words] of line.matchAll(/\b(f\d+) = ((?:(?! \. f\d+ = )[^,;])+)/g)) {
      const name =
        /^(?:the )?constructor of (\w+)/.exec(words.trim())?.[1] ??
        words.trim().split(/[\s(]/)[0].replace(/\.+$/, "").split(".").at(-1)!.replace(/^#+/, "");
      const numbers = numbersOf.get(name) ?? [];
      if (numbers.length === 1 && numbers[0] !== number) renumbered.set(number, numbers[0]);
    }
  if (!renumbered.size) return head;
  return head.map(line =>
    isDirective(line) || isLegend(line) ? line.replace(/\bf\d+\b/g, number => renumbered.get(number) ?? number) : line,
  );
}

/** The whole test, head and records, of a file of ../answers. */
export async function testOfStoredProgram(stored: string) {
  const [first, ...rest] = readFileSync(stored, "utf8").trimEnd().split("\n");
  const kind = /^\/\/ answers: (with|without)-library$/.exec(first)?.[1];
  if (!kind) throw new Error(`${stored}: line 1 is neither "// answers: without-library" nor "// answers: with-library"`);
  const lengthOfHead = rest.findIndex(line => !line.startsWith("// #"));
  const head = rest.slice(0, lengthOfHead).map(line => line.slice("// ".length));
  using folder = tempDir("aot-answers-test", { [basename(stored)]: rest.slice(lengthOfHead).join("\n") + "\n" });
  // The head says how many answers there are.
  const { shell, records } = await partsOf(join(String(folder), basename(stored)), kind === "without", false);
  // A function as the second operand: `$` in the text of a program means nothing to replace().
  const filled = head.map(line => line.replace("$SHELL", () => shell));
  return [...numberedByLegend(filled, records), "", ...records].join("\n") + "\n";
}

if (import.meta.main) {
  const operands = process.argv.slice(2);
  const isWithoutLibrary = operands.includes("--without-library");
  const isStored = operands.includes("--stored");
  const [source, ...sentences] = operands.filter(operand => !operand.startsWith("--"));
  if (!source) {
    console.error(
      'usage: bun test/aot/tools/answers-test-from-source.ts <source file> [--without-library] "<what the program is about>" | --stored <file of test/aot/answers>',
    );
    process.exit(2);
  }
  if (isStored) process.stdout.write(await testOfStoredProgram(source));
  else {
    const { lines, written, shell, answers, records, unknownIDs } = await partsOf(source, isWithoutLibrary);
    if (operands.includes("--store")) {
      console.log(
        [
          `// answers: ${isWithoutLibrary ? "without" : "with"}-library`,
          ...[
            ...sentences,
            "At the end the shell runs the same text itself: every answer is the same.",
            "RUN: run-in-shell $SHELL",
            `CHECK: ${answers} of ${answers} of ${answers}`,
            "CHECK-NEXT: exited with 0",
          ].map(line => `// # ${line}`),
          ...lines,
        ].join("\n"),
      );
      process.exit(0);
    }
    console.log(
      [
        // With these two marks ./update-ir-tests.ts writes the records anew, so that they do not go stale against the front end and the table of built-ins.
        ...(isWithoutLibrary
          ? written.map(line => `# ${line}`)
          : [`# -- source: ${basename(source)}`, ...lines.map(line => `# ${line}`.trimEnd()), "# -- end of source"]),
        ...sentences.map(sentence => `# ${sentence}`),
        "# At the end the shell runs the same text itself: every answer is the same.",
        `# RUN: run-in-shell ${shell}`,
        `# CHECK: ${answers} of ${answers} of ${answers}`,
        "# CHECK-NEXT: exited with 0",
        "",
        ...records,
      ].join("\n"),
    );
    if (unknownIDs.size) console.error(`these name no record: ${[...unknownIDs].join(" ")}`);
  }
}
