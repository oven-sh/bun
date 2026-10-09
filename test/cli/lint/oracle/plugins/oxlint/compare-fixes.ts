// Compares what `bun lint` and oxlint make of the files of fixes.ts with each of the flags.
//
//   BUN_LINT="<bun-lint> cli" OXLINT_BIN=<oxlint 1.87> OXLINT_TSGOLINT_PATH=<tsgolint 7.0.2003> bun compare-fixes.ts [--record]
//
// Without OXLINT_BIN, what oxlint makes of them is read from fixes.expected.json, which `--record` writes. With `--record` the cases in
// which `bun lint` does something else are written to fixes.differences.json. Without it, it is an error if they are others.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cases, directoryOf, filesOf, flagSets } from "./fixes.ts";

const [ours, ...oursArgs] = (process.env.BUN_LINT ?? "bun lint").split(" ");
const oxlint = process.env.OXLINT_BIN;
const record = process.argv.includes("--record");
const expectedPath = join(import.meta.dir, "fixes.expected.json");
const differencesPath = join(import.meta.dir, "fixes.differences.json");

type Texts = Record<string, Record<string, string>>;

/** The texts of the files after a run with each of the sets of flags. */
function run(command: string, before: string[]): Texts {
  const texts: Texts = {};
  for (const [name, flags] of Object.entries(flagSets)) {
    for (const typed of [false, true]) {
      const cwd = mkdtempSync(join(tmpdir(), "oxlint-fixes-"));
      try {
        writeFileSync(join(cwd, ".oxlintrc.json"), JSON.stringify({ categories: { correctness: "off" } }));
        const some = cases.map((it, index) => ({ it, directory: directoryOf(index) })).filter(({ it }) => !!it.typed === typed);
        for (const { it, directory } of some) {
          for (const [path, text] of Object.entries(filesOf(it))) {
            mkdirSync(dirname(join(cwd, directory, path)), { recursive: true });
            writeFileSync(join(cwd, directory, path), text);
          }
        }
        spawnSync(command, [...before, ...flags, ...(typed ? ["--type-aware"] : []), "."], { cwd, encoding: "utf8" });
        for (const { it, directory } of some) (texts[directory] ??= {})[name] = readFileSync(join(cwd, directory, it.file), "utf8");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  }
  return texts;
}

const expected: Texts = oxlint ? run(oxlint, []) : JSON.parse(readFileSync(expectedPath, "utf8"));
const actual = run(ours, oursArgs);
const differences: Record<string, string[]> = {};
for (const [directory, texts] of Object.entries(expected)) {
  const differing = Object.keys(texts).filter(flags => actual[directory][flags] !== texts[flags]);
  if (differing.length > 0) differences[directory] = differing;
  for (const flags of differing) {
    console.log(`${directory} ${flagSets[flags as keyof typeof flagSets].join(" ")}`);
    console.log(`  oxlint: ${JSON.stringify(texts[flags])}\n  ours:   ${JSON.stringify(actual[directory][flags])}`);
  }
}
console.log(`${cases.length} cases, ${Object.keys(differences).length} differ`);
if (record) {
  if (oxlint) writeFileSync(expectedPath, JSON.stringify(expected, null, 1) + "\n");
  writeFileSync(differencesPath, JSON.stringify(differences, null, 1) + "\n");
} else if (JSON.stringify(differences) !== JSON.stringify(JSON.parse(readFileSync(differencesPath, "utf8")))) {
  console.log("These are not the differences that fixes.differences.json records.");
  process.exit(1);
}
