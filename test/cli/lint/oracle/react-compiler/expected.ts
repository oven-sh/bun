// Writes expected.json: what oxlint reports for the inputs of ../../react-compiler.test.ts.
//
//   bun expected.ts --oxlint=<path to oxlint> [--cases=<oxc>/crates/oxc_linter/src/rules/react]
//   bun expected.ts --compare="<command>"
//
// Run it after a new release of oxlint, with `--cases` from the sources of that release: oxlint's own test cases are kept in
// expected.json, and are taken from there without `--cases`. The fixtures of the compiler that are named below are copied into it
// too. The other inputs are in inputs.ts.
//
// `--compare` writes nothing: it runs a command that takes oxlint's arguments on the same inputs and says where its reports are
// not those of expected.json. A fixture goes into the list only if there is no difference.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { casesOf } from "./cases.ts";
import { byFile, type Files, rc, small } from "./inputs.ts";
import { jsonDocuments, options } from "./shared.ts";

/** Of test/bundler/transpiler/react-compiler-fixtures: two to four for each rule that reports anything in them. */
const FIXTURES = [
  "allow-global-reassignment-in-effect.js",
  "context-variable-as-jsx-element-tag.js",
  "effect-derived-computations/derived-state-from-prop-setter-call-outside-effect-no-error.js",
  "effect-derived-computations/effect-with-global-function-call-no-error.js",
  "error.assign-global-in-component-tag-function.js",
  "error.bug-invariant-couldnt-find-binding-for-decl.js",
  "error.bug-invariant-expected-consistent-destructuring.js",
  "error.function-expression-references-variable-its-assigned-to.js",
  "error.hoist-optional-member-expression-with-conditional.js",
  "error.invalid-array-push-frozen.js",
  "error.invalid-disallow-mutating-ref-in-render.js",
  "error.invalid-eval-unsupported.js",
  "error.invalid-impure-functions-in-render.js",
  "error.invalid-optional-member-expression-as-memo-dep-non-optional-in-body.js",
  "error.invalid-pass-hook-as-prop.js",
  "error.invalid-props-mutation-in-effect-indirect.js",
  "error.invalid-reassign-variable-in-usememo.js",
  "error.invalid-ref-value-as-props.js",
  "error.invalid-setState-in-useMemo.js",
  "error.invalid-sketchy-code-use-forget.js",
  "error.invalid-unconditional-set-state-in-render.js",
  "error.mutate-global-increment-op-invalid-react.js",
  "error.todo-invalid-jsx-in-try-with-finally.js",
  "error.useMemo-non-literal-depslist.ts",
  "exhaustive-deps/error.invalid-dep-on-ref-current-value.js",
  "exhaustive-deps/error.invalid-exhaustive-effect-deps.js",
  "fbt/error.todo-locally-require-fbt.js",
  "invalid-jsx-in-catch-in-outer-try-with-catch.js",
  "invalid-jsx-in-try-with-catch.js",
  "invalid-set-state-in-effect-verbose-non-local-derived.js",
  "invalid-unused-usememo.js",
  "preserve-memo-validation/error.useMemo-property-call-dep.ts",
  "rules-of-hooks/error.invalid-conditionally-call-prop-named-like-hook.js",
  "rules-of-hooks/error.invalid-hook-as-prop.js",
  "rules-of-hooks/error.invalid-hook-for.js",
  "should-bailout-without-compilation-infer-mode.js",
  "static-components/invalid-dynamically-constructed-component-method-call.js",
  "timers.js",
  "use-no-forget-with-eslint-suppression.js",
  "useMemo-if-else-multiple-return.js",
  "useMemo-named-function.ts",
];
const fixturesDirectory = join(import.meta.dir, "../../../../bundler/transpiler/react-compiler-fixtures");

type Report = { exit: number; files: number; diagnostics: Record<string, unknown[]> };
export type Expected = {
  /** The version of oxlint. */
  oxlint: string;
  /** oxlint's own test cases: the path says the rule and whether the case is valid. */
  cases: Files;
  /** Fixtures of the compiler. */
  fixtures: Files;
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

const fixtures: Files = Object.fromEntries(
  FIXTURES.map(name => [name, readFileSync(join(fixturesDirectory, name), "utf8")]),
);

const reports: Expected["reports"] = {
  cases: run({ ".oxlintrc.json": rc(), ...cases }),
  fixtures: run({ ".oxlintrc.json": rc(), ...fixtures }),
};
for (const [name, files] of Object.entries(small)) reports[name] = run(files);

if (compare === undefined) {
  const oxlint = /\d+\.\d+\.\d+/.exec(spawn(["--version"], import.meta.dir).stdout.toString())?.[0] ?? "";
  writeFileSync(path, JSON.stringify({ oxlint, cases, fixtures, reports } satisfies Expected, null, 1) + "\n");
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
