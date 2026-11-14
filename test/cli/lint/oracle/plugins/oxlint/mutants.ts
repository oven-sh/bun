// A value that's the same in every recorded input looks like a fixed part of the text, such as `'x'` in "Found
// identifier 'x' with the same name as a label." This script finds values like that hard-coded in the text `bun lint`
// copies from oxlint: messages, help, labels and notes.
//
//   BUN_LINT="bun lint" OXLINT_BIN=<oxlint 1.87> OXLINT_TSGOLINT_PATH=<tsgolint 7.0.2003> bun mutants.ts
//
// For each input in messages.json, it takes every word or number that's in both oxlint's output and the input (the
// code, the options, the filename) and replaces it in the input with another one of the same shape. If oxlint reports
// nothing for that mutant, it tries a longer one. Both tools lint the mutants. It's an error if their output differs
// for a mutant whose original they agree on.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { entries, filesOf, type Entry } from "./messages.ts";

const [ours, ...oursArgs] = (process.env.BUN_LINT ?? "bun lint").split(" ");
const oxlint = process.env.OXLINT_BIN;
if (!oxlint) throw new Error("OXLINT_BIN is not set");

const word = /[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?/g;
// Replacing one of these would change the program's meaning.
const reservedWords = new Set(
  "abstract any as asserts async await bigint boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get global if implements import in infer instanceof interface is keyof let module namespace never new null number object of out override package private protected public readonly require return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown using var void while with yield a an the and or not to be it".split(
    " ",
  ),
);
const wholeWord = (it: string) => new RegExp(`(?<![A-Za-z0-9_$])${it.replace(/[.$]/g, "\\$&")}(?![A-Za-z0-9_$])`, "g");

/**
 * Returns a word that isn't in the input. Round 1 shifts each letter, or adds 1 to a number. Round 2 appends a letter,
 * or adds 2.
 */
function replacementFor(it: string, taken: Set<string>, round: number): string {
  if (/^\d/.test(it)) return String(Number(it) + round);
  if (round === 2) return ["q", "Q", "qq", "qqq"].map(end => it + end).find(made => !taken.has(made))!;
  // Keep the prefixes that rules recognize names by.
  const start = /^(use|on|handle|set|get|is|has)(?=[A-Z])/.exec(it)?.[0].length ?? 0;
  const shifted = (c: string, first: number, step: number) =>
    String.fromCharCode(((c.charCodeAt(0) - first + step) % 26) + first);
  for (let step = 1; step < 26; step++) {
    const rest = it
      .slice(start)
      .replace(/[a-z]/g, c => shifted(c, 97, step))
      .replace(/[A-Z]/g, c => shifted(c, 65, step));
    if (!reservedWords.has(it.slice(0, start) + rest) && !taken.has(it.slice(0, start) + rest))
      return it.slice(0, start) + rest;
  }
  return `${it}q`;
}

function replaced(value: unknown, from: string, to: string, inKeys: boolean): unknown {
  if (typeof value === "string") return value.replace(wholeWord(from), () => to);
  if (typeof value === "number") return Number(from) === value ? Number(to) : value;
  if (Array.isArray(value)) return value.map(it => replaced(it, from, to, inKeys));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, it]) => [
      inKeys ? (replaced(key, from, to, false) as string) : key,
      replaced(it, from, to, inKeys),
    ]),
  );
}

type Report = { code: string; message: string; help: string; labels: string[]; note: string };

/** Returns a tool's reports in each entry's directory, in source order, or `null` if it rejects the entry's config. */
function lint(command: string, before: string[], all: Entry[]): (Report[] | null)[] {
  const cwd = mkdtempSync(join(tmpdir(), "oxlint-mutants-"));
  const reportsByEntry: (Report[] | null)[] = all.map(() => []);
  // A rejected config ends the whole run, so bisect until the run has only that entry.
  const run = (some: number[]) => {
    if (some.length === 0) return;
    const args = [...before, "--type-aware", "--no-ignore", "-f", "json", ...some.map(String)];
    const { stdout } = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
    if (!stdout.startsWith("{")) {
      if (some.length === 1) return void (reportsByEntry[some[0]] = null);
      return void (run(some.slice(0, some.length >> 1)), run(some.slice(some.length >> 1)));
    }
    const found: Record<number, [number, Report][]> = {};
    for (const it of JSON.parse(stdout).diagnostics) {
      const labels = it.labels.map((label: { label?: string }) => label.label ?? "");
      (found[Number(it.filename.split("/")[0])] ??= []).push([
        it.labels[0]?.span.offset ?? -1,
        { code: it.code ?? "", message: it.message, help: it.help ?? "", labels, note: it.note ?? "" },
      ]);
    }
    for (const [index, reports] of Object.entries(found)) {
      reportsByEntry[Number(index)] = reports
        .sort((a, b) => a[0] - b[0] || (a[1].message < b[1].message ? -1 : 1))
        .map(it => it[1]);
    }
  };
  try {
    for (const [file, text] of Object.entries(filesOf(all))) {
      mkdirSync(dirname(join(cwd, file)), { recursive: true });
      writeFileSync(join(cwd, file), text);
    }
    run(all.map((_, index) => index));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  return reportsByEntry;
}
const both = (all: Entry[]) => {
  const [theirs, mine] = [lint(oxlint, [], all), lint(ours, oursArgs, all)];
  return all.map((_, index) => ({ theirs: theirs[index], mine: mine[index] }));
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Value = { entry: Entry; from: string; taken: Set<string> };
let values: Value[] = [];
both(entries).forEach(({ theirs, mine }, index) => {
  const entry = entries[index];
  // Entries that already differ without a mutation are covered by other oracles.
  if (!theirs?.length || !same(theirs, mine)) return;
  const given = `${entry.code} ${JSON.stringify(entry.options)} ${basename(entry.file)}`;
  const texts = theirs.map(it => [it.message, it.help, ...it.labels, it.note].join(" ")).join(" ");
  const inBoth = [...new Set(texts.match(word))].filter(it => !reservedWords.has(it) && wholeWord(it).test(given));
  for (const from of inBoth.slice(0, 8)) values.push({ entry, from, taken: new Set(given.match(word)) });
});

let [mutants, live, failed] = [0, 0, 0];
const all = values.length;
for (const round of [1, 2]) {
  const made = values.flatMap((value, index) => {
    const { entry, from, taken } = value;
    const to = replacementFor(from, taken, round);
    const [name, ...extensions] = basename(entry.file).split(".");
    const candidates: Entry[] = [false, true].map(inKeys => ({
      ...entry,
      code: replaced(entry.code, from, to, false) as string,
      options: replaced(entry.options, from, to, inKeys) as unknown[],
    }));
    candidates.push({
      ...entry,
      file: join(dirname(entry.file), [replaced(name, from, to, false), ...extensions].join(".")),
    });
    const isNew = (it: Entry, at: number) =>
      !same(it, entry) && !candidates.slice(0, at).some(before => same(before, it));
    return candidates.filter(isNew).map(mutant => ({ index, from, to, mutant }));
  });
  const alive = new Set<number>();
  both(made.map(it => it.mutant)).forEach(({ theirs, mine }, at) => {
    const { index, from, to, mutant } = made[at];
    mutants++;
    // oxlint reports nothing for it, or a parse error.
    if (!theirs?.length || theirs.some(it => !it.code.includes("("))) return;
    alive.add(index);
    live++;
    if (same(theirs, mine)) return;
    failed++;
    console.error(
      `${mutant.rule} ${mutant.id}: ${from} -> ${to}: ${JSON.stringify(mutant.code)} ${JSON.stringify(mutant.options)} ${mutant.file}`,
    );
    console.error(`  oxlint:   ${JSON.stringify(theirs)}\n  bun lint: ${JSON.stringify(mine)}`);
  });
  values = values.filter((_, index) => !alive.has(index));
}
console.log(
  `mutants: ${live - failed} of ${live} agree; ${all} values, ${mutants} mutants, ${values.length} values about which oxlint says nothing`,
);
process.exit(failed ? 1 : 0);
