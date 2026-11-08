// Writes expected.json, which has what oxlint and ESLint report for the inputs of ../../react-compiler.test.ts.
//
//   bun expected.ts --oxlint=<path to oxlint> [--cases=<oxc>/crates/oxc_linter/src/rules/react]
//   bun expected.ts --modules=<node_modules>
//   bun expected.ts --compare="<command>"
//
// Run it after a new oxlint release, with `--cases` pointing at that release's sources. oxlint's own test cases are
// stored in expected.json, and are read from there without `--cases`. The compiler fixtures listed below are copied
// into it too (`--fixtures=<directory>` reads them from another directory). The other inputs are in inputs.ts.
//
// Run it with `--modules` after a new eslint-plugin-react-hooks release. <node_modules> needs the plugin, eslint and
// @typescript-eslint/parser. The parts of expected.json that a run doesn't record are kept.
//
// `--compare` doesn't write anything. It runs a command that accepts both oxlint's and ESLint's arguments on the same
// inputs, first with oxlint's config file and then with ESLint's, and prints where its reports differ from
// expected.json. Only add a fixture to the list if it doesn't differ from oxlint, and add it to `NOT_WITH_ESLINT` if it
// differs from ESLint.

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { casesOf } from "./cases.ts";
import { configOf } from "./eslint.ts";
import {
  briefly,
  byEslintFile,
  byFile,
  ESLINT_RULES,
  eslintConfig,
  eslintSmall,
  type Files,
  rc,
  small,
} from "./inputs.ts";
import { jsonDocuments, options } from "./shared.ts";

/** From test/bundler/transpiler/react-compiler-fixtures: two to four for each rule that reports anything in them. */
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
/** Inputs for which `bun lint` and the plugin report different things: an `fbt` that isn't imported. */
const NOT_WITH_ESLINT = new Set(["todo/02.invalid.tsx", "fbt/error.todo-locally-require-fbt.js"]);

type Report = { exit: number; files: number; diagnostics: Record<string, unknown[]> };
export type Expected = {
  /** oxlint's version. */
  oxlint: string;
  /** oxlint's own test cases. The path has the rule and whether the case is valid. */
  cases: Files;
  /** Compiler fixtures. */
  fixtures: Files;
  /** oxlint's report for each directory of inputs. Only files with diagnostics are listed. */
  reports: Record<string, Report>;
  eslint: {
    /** The versions of ESLint and the plugin. */
    eslint: string;
    plugin: string;
    /** The inputs in `cases` and `fixtures` that aren't linted. */
    without: string[];
    /** Each message's rule, location and first line. Only files with messages are listed. */
    cases: Record<string, string[]>;
    fixtures: Record<string, string[]>;
    /** The complete messages. */
    small: ReturnType<typeof byEslintFile>;
  };
};

const { flags } = options(process.argv.slice(2));
const path = join(import.meta.dir, "expected.json");
const compare = flags.get("compare");
if (compare === undefined && !flags.has("oxlint") && !flags.has("modules")) {
  throw new Error("--oxlint=<path to oxlint>, --modules=<node_modules> or --compare=<command>");
}
const before = (): Expected => JSON.parse(readFileSync(path, "utf8"));
const command = (compare ?? resolve(flags.get("oxlint") ?? "")).split(" ");

const spawn = (args: string[], cwd: string) =>
  Bun.spawnSync({
    cmd: [...command, ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });

/** Runs the command with `-f json` in a temporary directory with `files`, and passes its output to `then`. */
function inDirectory<T>(files: Files, then: (stdout: string, exit: number, directory: string) => T | null): T {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "react-compiler-")));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, name)), { recursive: true });
      writeFileSync(join(directory, name), text);
    }
    const result = spawn(["-f", "json"], directory);
    const found = then(result.stdout.toString(), result.exitCode, directory);
    if (found === null)
      throw new Error(`No report (exit ${result.exitCode}): ${result.stderr.toString().slice(0, 1000)}`);
    return found;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const likeOxlint = (files: Files): Report =>
  inDirectory(files, (stdout, exit) => {
    for (const document of jsonDocuments(stdout)) {
      const report = document as { diagnostics?: []; number_of_files?: number };
      if (report.diagnostics === undefined || report.number_of_files === undefined) continue;
      return { exit, files: report.number_of_files, diagnostics: byFile({ diagnostics: report.diagnostics }) };
    }
    return null;
  });

const likeEslint = (files: Files) =>
  inDirectory({ "eslint.config.js": eslintConfig, ...files }, (stdout, _, directory) =>
    stdout.startsWith("[")
      ? byEslintFile(JSON.parse(stdout.slice(0, stdout.indexOf("\n") + 1 || undefined)), [directory])
      : null,
  );

/** Runs real ESLint in-process, without writing the files to disk. */
function eslint(modules: string, files: Files) {
  type Linter = { verify(text: string, config: object[], options: object): []; getSuppressedMessages(): [] };
  const { Linter } = createRequire(join(modules, "x.js"))("eslint") as { Linter: new (options: object) => Linter };
  const linter = new Linter({ configType: "flat", cwd: "/directory" });
  // List the rules in the same order as `eslintConfig`, because messages at the same location are reported in that
  // order.
  const [first, ...others] = configOf(modules).config;
  const config = [{ ...first, rules: Object.fromEntries(ESLINT_RULES.map(rule => [rule, "error"])) }, ...others];
  const results = Object.entries(files).map(([name, text]) => ({
    filePath: `/directory/${name}`,
    messages: linter.verify(text, config, { filename: `/directory/${name}` }),
    suppressedMessages: linter.getSuppressedMessages(),
  }));
  return byEslintFile(results, ["/directory"]);
}

const cases: Files = flags.has("cases")
  ? Object.fromEntries([...casesOf(resolve(flags.get("cases")!))].map(([name, item]) => [name, item.code]))
  : before().cases;
const fixturesDirectory = resolve(
  flags.get("fixtures") ?? join(import.meta.dir, "../../../../bundler/transpiler/react-compiler-fixtures"),
);
const fixtures: Files = Object.fromEntries(
  FIXTURES.map(name => [name, readFileSync(join(fixturesDirectory, name), "utf8")]),
);
const withEslint = (files: Files): Files =>
  // ESLint doesn't lint files in `node_modules`.
  Object.fromEntries(
    Object.entries(files).filter(([name]) => !NOT_WITH_ESLINT.has(name) && !name.includes("node_modules/")),
  );

function reportsOf(): Expected["reports"] {
  const reports: Expected["reports"] = {
    cases: likeOxlint({ ".oxlintrc.json": rc(), ...cases }),
    fixtures: likeOxlint({ ".oxlintrc.json": rc(), ...fixtures }),
  };
  for (const [name, files] of Object.entries(small)) reports[name] = likeOxlint(files);
  return reports;
}

const total = (files: Record<string, unknown[]>) => Object.values(files).reduce((sum, found) => sum + found.length, 0);

if (compare === undefined) {
  const expected: Partial<Expected> = {
    ...(flags.has("oxlint") && flags.has("modules") && flags.has("cases") ? {} : before()),
  };
  Object.assign(expected, { cases, fixtures });
  if (flags.has("oxlint")) {
    expected.oxlint = /\d+\.\d+\.\d+/.exec(spawn(["--version"], import.meta.dir).stdout.toString())?.[0] ?? "";
    expected.reports = reportsOf();
    for (const [name, report] of Object.entries(expected.reports)) {
      console.log(
        `oxlint, ${name}: ${report.files} files, ${total(report.diagnostics)} diagnostics, exit ${report.exit}`,
      );
    }
  }
  if (flags.has("modules")) {
    const modules = resolve(flags.get("modules")!);
    const version = (name: string) => JSON.parse(readFileSync(join(modules, name, "package.json"), "utf8")).version;
    expected.eslint = {
      eslint: version("eslint"),
      plugin: version("eslint-plugin-react-hooks"),
      without: [...NOT_WITH_ESLINT],
      cases: briefly(eslint(modules, withEslint(cases))),
      fixtures: briefly(eslint(modules, withEslint(fixtures))),
      small: eslint(modules, eslintSmall),
    };
    console.log(`ESLint, cases: ${total(expected.eslint.cases)} messages`);
    console.log(`ESLint, fixtures: ${total(expected.eslint.fixtures)} messages`);
    console.log(`ESLint, small: ${total(briefly(expected.eslint.small))} messages`);
  }
  const { oxlint, reports, eslint: eslintReports } = expected as Expected;
  writeFileSync(
    path,
    JSON.stringify({ oxlint, cases, fixtures, reports, eslint: eslintReports } satisfies Expected, null, 1) + "\n",
  );
} else {
  const expected = before();
  let different = 0;
  const differs = (name: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    different++;
    console.log(`${name}\n  expected ${JSON.stringify(a)}\n  reported ${JSON.stringify(b)}`);
  };
  const each = (name: string, a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const file of new Set([...Object.keys(a), ...Object.keys(b)])) differs(`${name}/${file}`, a[file], b[file]);
  };
  for (const [name, report] of Object.entries(reportsOf())) {
    const theirs = expected.reports[name];
    if (theirs.exit !== report.exit) console.log(`${name}: exit ${report.exit}, not ${theirs.exit}`);
    if (theirs.files !== report.files) console.log(`${name}: ${report.files} files, not ${theirs.files}`);
    each(`oxlint, ${name}`, theirs.diagnostics, report.diagnostics);
  }
  each("ESLint, cases", expected.eslint.cases, briefly(likeEslint(withEslint(cases))));
  each("ESLint, fixtures", expected.eslint.fixtures, briefly(likeEslint(withEslint(fixtures))));
  each("ESLint, small", expected.eslint.small, likeEslint(eslintSmall));
  console.log(`${different} files differ`);
  process.exitCode = different === 0 ? 0 : 1;
}
