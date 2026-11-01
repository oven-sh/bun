// What an object pattern reads has two places: the one a stack trace names when a getter throws, and the one where the name stands in the text. The build report lists each access where it is written.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { run } from "./harness/run";
import { test } from "./supported";

const program = `function spanOf({ spanStart, spanEnd }) {
  return spanEnd - spanStart;
}
function rangeOf(range) {
  const { rangeLow, rangeHigh } = range;
  return rangeHigh - rangeLow;
}
function linesOf({ first: { line }, last: { line: lastLine } }) {
  return lastLine - line;
}
class Marked {
  #mark = 1;
  static isMarked(value) {
    return #mark in value;
  }
}
const spans = [], ranges = [], pairs = [], values = [];
for (let i = 0; i < 100; i++) {
  spans.push({ spanStart: i, spanEnd: i * 3 });
  ranges.push({ rangeLow: i, rangeHigh: i * 3 });
  pairs.push({ first: { line: i }, last: { line: i * 2 } });
  values.push(i % 2 ? new Marked() : {});
}
let total = 0;
for (let i = 0; i < 100; i++) {
  total += spanOf(spans[i]) + rangeOf(ranges[i]) + linesOf(pairs[i]) + (Marked.isMarked(values[i]) ? 1 : 0);
}
console.log(total);
function frameOf(call) {
  try {
    call();
  } catch (error) {
    return error.stack.split("\\n")[2].replace(/\\(.*[\\\\/]/, "(");
  }
}
console.log(frameOf(() => spanOf({ get spanStart() { throw new Error("start"); }, spanEnd: 1 })));
console.log(frameOf(() => spanOf({ spanStart: 1, get spanEnd() { throw new Error("end"); } })));
`;

test("the report lists each name of an object pattern where it is written, and a stack trace is that of `bun run`", async () => {
  using dir = tempDir("aot-the-report-lists-an-access-where-it-is-written", { "program.js": program });
  const executable = join(String(dir), isWindows ? "program.exe" : "program.out");
  const report = join(String(dir), "report.json");
  const built = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--aot-report=" + report,
      "--aot-report-detail=sites",
      "program.js",
      "--outfile",
      executable,
    ],
    String(dir),
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });

  const { accessSites, functions } = readBuildReport(report);
  const placesIn = (name: string, kind: string) =>
    accessSites!
      .filter(site => site.function !== null && functions![site.function].name === name && site.kind === kind)
      .map(site => site.line + ":" + site.column);
  expect({
    spanOf: placesIn("spanOf", "read"),
    rangeOf: placesIn("rangeOf", "read"),
    linesOf: placesIn("linesOf", "read"),
    isMarked: placesIn("isMarked", "has"),
  }).toEqual({
    spanOf: ["1:19", "1:30"],
    rangeOf: ["5:11", "5:21"],
    linesOf: ["8:20", "8:29", "8:37", "8:45"],
    isMarked: ["14:12"],
  });

  const plain = await run([bunExe(), "run", "program.js"], String(dir));
  expect(plain.stdout.split("\n").slice(1, 3)).toEqual([
    "    at spanOf (program.js:2:10)",
    "    at spanOf (program.js:2:10)",
  ]);
  expect(await run([executable], String(dir))).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0 });
});
