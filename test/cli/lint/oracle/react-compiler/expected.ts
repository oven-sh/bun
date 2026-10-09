// Writes expected.json: what oxlint reports for the inputs of ../../react-compiler.test.ts.
//
//   bun expected.ts --oxlint=<path to oxlint> [--cases=<oxc>/crates/oxc_linter/src/rules/react]
//   bun expected.ts --compare="<command>"
//
// Run it after a new release of oxlint, with `--cases` from the sources of that release: oxlint's own test cases are kept in
// expected.json, and are taken from there without `--cases`. The other inputs are in inputs.ts.
//
// `--compare` writes nothing: it runs a command that takes oxlint's arguments on the same inputs and says where its reports are
// not those of expected.json. A fixture goes into the list of inputs.ts only if there is no difference.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { casesOf } from "./cases.ts";
import { byFile, type Files, fixtures, rc, small } from "./inputs.ts";
import { jsonDocuments, options } from "./shared.ts";

type Report = { exit: number; files: number; diagnostics: Record<string, unknown[]> };
export type Expected = {
  /** The version of oxlint. */
  oxlint: string;
  /** oxlint's own test cases: the path says the rule and whether the case is valid. */
  cases: Files;
  /** For each directory of inputs. Only the files that have diagnostics are named. */
  reports: Record<string, Report>;
};

const { flags } = options(process.argv.slice(2));
const path = join(import.meta.dir, "expected.json");
const compare = flags.get("compare");
const command = (compare ?? resolve(flags.get("oxlint") ?? process.env.OXLINT ?? "")).split(" ");
if (compare === undefined && !flags.has("oxlint") && !process.env.OXLINT) throw new Error("--oxlint=<path to oxlint>");

const spawn = (args: string[], cwd: string) =>
  Bun.spawnSync({
    cmd: [...command, ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });

function run(files: Files): Report {
  const directory = mkdtempSync(join(tmpdir(), "react-compiler-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, name)), { recursive: true });
      writeFileSync(join(directory, name), text);
    }
    const result = spawn(["-f", "json"], directory);
    for (const document of jsonDocuments(result.stdout.toString())) {
      const report = document as { diagnostics?: []; number_of_files?: number };
      if (report.diagnostics === undefined || report.number_of_files === undefined) continue;
      return {
        exit: result.exitCode,
        files: report.number_of_files,
        diagnostics: byFile({ diagnostics: report.diagnostics }),
      };
    }
    throw new Error(`No report (exit ${result.exitCode}): ${result.stderr.toString().slice(0, 1000)}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const cases: Files = flags.has("cases")
  ? Object.fromEntries([...casesOf(resolve(flags.get("cases")!))].map(([name, item]) => [name, item.code]))
  : (JSON.parse(readFileSync(path, "utf8")) as Expected).cases;

const reports: Expected["reports"] = {
  cases: run({ ".oxlintrc.json": rc(), ...cases }),
  fixtures: run(fixtures()),
};
for (const [name, files] of Object.entries(small)) reports[name] = run(files);

if (compare === undefined) {
  const oxlint = /\d+\.\d+\.\d+/.exec(spawn(["--version"], import.meta.dir).stdout.toString())?.[0] ?? "";
  writeFileSync(path, JSON.stringify({ oxlint, cases, reports } satisfies Expected, null, 1) + "\n");
  for (const [name, report] of Object.entries(reports)) {
    const count = Object.values(report.diagnostics).reduce((sum, found) => sum + found.length, 0);
    console.log(`${name}: ${report.files} files, ${count} diagnostics, exit ${report.exit}`);
  }
} else {
  const expected = (JSON.parse(readFileSync(path, "utf8")) as Expected).reports;
  let different = 0;
  for (const [name, report] of Object.entries(reports)) {
    const theirs = expected[name];
    if (theirs.exit !== report.exit) console.log(`${name}: exit ${report.exit}, not ${theirs.exit}`);
    if (theirs.files !== report.files) console.log(`${name}: ${report.files} files, not ${theirs.files}`);
    for (const file of new Set([...Object.keys(theirs.diagnostics), ...Object.keys(report.diagnostics)])) {
      const [a, b] = [theirs.diagnostics[file] ?? [], report.diagnostics[file] ?? []];
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      different++;
      console.log(`${name}/${file}\n  expected ${JSON.stringify(a)}\n  reported ${JSON.stringify(b)}`);
    }
  }
  console.log(`${different} files differ`);
  process.exitCode = different === 0 ? 0 : 1;
}
