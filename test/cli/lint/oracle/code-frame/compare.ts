// Compares `bun_lint::utils::code_frame` with `codeFrameColumns` of @babel/code-frame 7 and 8, on generated texts and ranges.
//   bun compare.ts <bun-lint> <directory of @babel/code-frame 7> <directory of @babel/code-frame 8>
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Place = { line: number; column?: number };
type Options = { linesAbove: number; linesBelow: number; message?: string };
type CodeFrameColumns = (text: string, location: { start: Place; end?: Place }, options: Options) => string;

const [binary, seven, eight] = process.argv.slice(2);
const judges: Record<number, CodeFrameColumns> = {
  7: (await import(join(seven, "lib/index.js"))).codeFrameColumns,
  8: (await import(join(eight, "lib/index.js"))).codeFrameColumns,
};

let seed = 0x2545f491;
function random(below: number): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) % below;
}
const pick = <T>(from: readonly T[]): T => from[random(from.length)];
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");

const cases: { line: string; expected: string; group: string }[] = [];

/** The rows of `frame` that belong to the lines `from` to `to`, `to` not included. A row of markers belongs to the line above it. */
function rowsOf(frame: string, from: number, to: number): string {
  let isShown = false;
  const rows = frame.split("\n").filter(row => {
    const number = /^[> ] *(\d+) \|/.exec(row);
    if (number) isShown = from <= +number[1] && +number[1] < to;
    return isShown;
  });
  return rows.join("\n");
}

function add(group: string, version: number, text: string, start: Place, end: Place | undefined, options: Options, shown?: [number, number]) {
  let expected: string;
  try {
    const frame = judges[version](text, end ? { start, end } : { start }, options);
    expected = hex(shown ? rowsOf(frame, ...shown) : frame);
  } catch {
    expected = "throws";
  }
  const fields = [version, start.line, start.column ?? "-", end?.line ?? "-", end?.column ?? "-", options.linesAbove, options.linesBelow, ...(shown ?? ["-", "-"]), hex(options.message ?? ""), hex(text)];
  cases.push({ line: fields.join("\t"), expected, group: `${group} ${version}` });
}

const BREAKS = ["\n", "\n", "\n", "\r\n", "\r", "\u2028", "\u2029"];
const PIECES = ["a", "bc", " ", "  ", "\t", "\t\t", "é", "日本", "😀", "x😀", "😀😀", "|", "^", ">", "1 |", "\u0085", "\u000B", "\uFEFF"];
const MESSAGES = ["", "", "message", "two words", "é😀\t", " "];
const FAR = [0, 0, 1, 2, 2, 3, 3, 5, 10, 1000, 0xffff_ffff];

function lineOf(): string {
  return Array.from({ length: pick([0, 0, 1, 1, 2, 3, 5, 9]) }, () => pick(PIECES)).join("");
}

function textOf(lines: number, breaks: readonly string[]): string {
  let text = "";
  for (let i = 0; i < lines; i++) text += lineOf() + (i + 1 < lines || random(2) ? pick(breaks) : "");
  return text;
}

const NEWLINE = /\r\n|[\n\r\u2028\u2029]/;

/** A column of `line`: missing, 0, in it, at its end, or behind it. */
function columnOf(line: string | undefined): number | undefined {
  const length = line?.length ?? 0;
  return pick([undefined, 0, 1, random(length + 1), random(length + 1), length, length + 1, length + 2, length + 7]);
}

function generated(group: string, times: number, linesOf: () => number, breaks: readonly string[] = BREAKS) {
  for (let i = 0; i < times; i++) {
    const text = textOf(linesOf(), breaks);
    const lines = text.split(NEWLINE);
    for (let j = 0; j < 12; j++) {
      const startLine = pick([random(lines.length) + 1, random(lines.length) + 1, random(lines.length) + 1, 0, 1, lines.length, lines.length + 1, lines.length + 4]);
      const start: Place = { line: startLine, column: columnOf(lines[startLine - 1]) };
      if (start.column === undefined) delete start.column;
      let end: Place | undefined;
      if (random(5)) {
        const endLine = Math.max(0, startLine + pick([0, 0, 0, 1, 1, 2, 3, 9, 10, 11, random(lines.length + 2), -1]));
        end = { line: endLine, column: columnOf(lines[endLine - 1]) };
        if (end.column === undefined) delete end.column;
      }
      const options: Options = { linesAbove: pick(FAR), linesBelow: pick(FAR), message: pick(MESSAGES) };
      for (const version of [7, 8]) {
        add(group, version, text, start, end, options);
        // Only where every row says which line it is of: a message without columns is a row of its own.
        if (start.column !== undefined || !options.message) {
          const from = random(lines.length + 2);
          add(`${group}, some rows`, version, text, start, end, options, [from, from + pick([0, 1, 2, 7, 8, lines.length])]);
        }
      }
    }
  }
}

generated("few lines", 2500, () => random(9));
generated("one kind of line break", 500, () => random(9), [pick(BREAKS)]);
generated("9 to 10 lines", 400, () => 7 + random(7));
generated("99 to 100 lines", 150, () => 95 + random(11));
generated("999 to 1000 lines", 30, () => 995 + random(11));

// Every range of some small texts.
for (const text of ["", "a", "\n", "ab\n", "ab\ncd", "a\r\n\tb\r😀c\u2028\n", "\t\ta\n\n\tb😀\nc"]) {
  const lines = text.split(NEWLINE);
  const columns = [undefined, 0, 1, 2, 3, 4, 5];
  for (let startLine = 0; startLine <= lines.length + 1; startLine++) {
    for (const startColumn of columns) {
      const start = startColumn === undefined ? { line: startLine } : { line: startLine, column: startColumn };
      for (const message of ["", "m", "a\nb"]) {
        for (const version of [7, 8]) add("every range", version, text, start, undefined, { linesAbove: 2, linesBelow: 3, message });
        for (let endLine = 0; endLine <= lines.length + 1; endLine++) {
          for (const endColumn of columns) {
            const end = endColumn === undefined ? { line: endLine } : { line: endLine, column: endColumn };
            for (const version of [7, 8]) add("every range", version, text, start, end, { linesAbove: 2, linesBelow: 3, message });
          }
        }
      }
    }
  }
}

// A long line is printed whole.
for (const version of [7, 8]) {
  const long = "x".repeat(1 << 20) + "😀" + "\ty".repeat(1 << 10);
  add("a long line", version, `a\n${long}\nb`, { line: 2, column: (1 << 20) + 5 }, { line: 2, column: (1 << 20) + 9 }, { linesAbove: 2, linesBelow: 3, message: "here" });
  add("a long line", version, `a\n${long}\n${long}\nb`, { line: 1, column: 1 }, { line: 4, column: 1 }, { linesAbove: 2, linesBelow: 3, message: "here" });
}

// `"^".repeat(..)` throws, if the line is shown.
for (const version of [7, 8]) {
  for (const [startLine, endLine] of [[1, 1], [1, 2], [1, 3], [1, 5], [2, 2], [3, 3], [2, 3]]) {
    add("a column that no text has", version, "ab\ncd", { line: startLine, column: 1 }, { line: endLine, column: 0xffff_ffff }, { linesAbove: 2, linesBelow: 3 });
  }
}

const directory = mkdtempSync(join(tmpdir(), "code-frame-"));
const input = join(directory, "input.txt");
writeFileSync(input, cases.map(it => it.line).join("\n") + "\n");
const { stdout, status } = spawnSync(binary, ["code-frame", input], { encoding: "utf8", maxBuffer: 1 << 30 });
rmSync(directory, { recursive: true, force: true });
const actual = stdout.split("\n");
const failed: Record<string, number> = {};
const total: Record<string, number> = {};
const text = (it: string | undefined) => (it === undefined || !/^([0-9a-f]{2})*$/.test(it) ? String(it) : JSON.stringify(Buffer.from(it, "hex").toString("utf8"))).slice(0, 600);
cases.forEach((it, i) => {
  total[it.group] = (total[it.group] ?? 0) + 1;
  if (actual[i] === it.expected) return;
  failed[it.group] = (failed[it.group] ?? 0) + 1;
  if (failed[it.group] > 3) return;
  const fields = it.line.split("\t");
  console.log(`${it.group}: ${fields.slice(1, 9).join(" ")} message ${text(fields[9])} text ${text(fields[10])}\n  expected ${text(it.expected)}\n  actual   ${text(actual[i])}`);
});
for (const group in total) console.log(`${group}: ${total[group] - (failed[group] ?? 0)}/${total[group]}`);
process.exit(status === 0 && Object.keys(failed).length === 0 ? 0 : 1);
