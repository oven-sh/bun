// `oxlint-disable`, `eslint-disable` and the like as oxlint itself applies them against `Linter::lint` with a configuration of
// oxlint: generated files are linted by both, in one run. Compared: which rule reports with which severity at which line and
// column, and what is said about comments that do nothing, with its place. And once more through the command line: all that
// `-f json` of the two has about a report.
//
// The last 400 files start with comments that configure ESLint. oxlint takes these for ordinary comments, even where ESLint
// reports them.
//
//   OXLINT=<the oxlint executable> node oxlint-directives.mjs [<how many differences to show>]

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bunLintPrints, random, report, reportsOfOxlint, runBunLint, strictly } from "./shared.mjs";

const oxlint = resolve(process.env.OXLINT ?? "oxlint");
const show = Number(process.argv[2] ?? 8);

// Rules that report the same range in both.
const rules = { "no-debugger": "error", "no-var": "warn", "typescript/no-non-null-assertion": "error" };
const config = { categories: { correctness: "off" }, rules, options: { reportUnusedDisableDirectives: "warn" } };
const idOf = {
  "eslint(no-debugger)": "no-debugger",
  "eslint(no-var)": "no-var",
  "typescript(no-non-null-assertion)": "@typescript-eslint/no-non-null-assertion",
};

const rng = random(31);
const list = (make, min, max) => Array.from({ length: min + rng.int(max - min + 1) }, make);
const name = () =>
  rng.pick([
    "no-debugger",
    "no-debugger",
    "no-var",
    "no-var",
    "eslint/no-debugger",
    "eslint/no-var",
    "no-non-null-assertion",
    "typescript/no-non-null-assertion",
    "@typescript-eslint/no-non-null-assertion",
    "typescript-eslint/no-non-null-assertion",
    "typescript/no-debugger",
    "@typescript-eslint/no-var",
    "no-console",
    "no-eval",
  ]);
const names = () => {
  const all = list(name, 0, 3);
  let text = "";
  all.forEach((it, i) => (text += (i ? rng.pick([", ", ", ", ",", " , ", " ", "  "]) : "") + it));
  return text;
};
const why = () => rng.pick(["", "", "", " -- why", " -- no-var", " - why", "-- why", " --why", " -why"]);
const directive = kinds => `${rng.pick(["eslint", "oxlint"])}-${rng.pick(kinds)}`;
const all = ["disable", "disable", "enable", "disable-line", "disable-next-line"];
const comment = () => {
  const space = rng.pick([" ", " ", " ", "", "  "]);
  const listed = names();
  const text = `${space}${directive(all)}${listed ? ` ${listed}` : ""}${why()}`;
  return rng.int(2) ? `//${text}` : `/*${text}${rng.pick([" ", " ", ""])}*/`;
};
const statement = () =>
  rng.pick([
    "debugger;",
    "debugger;",
    "var a;",
    "var b = 1;",
    "x!;",
    "foo();",
    "{ debugger; }",
    "if (a) {\n  debugger;\n}",
    "var c =\n  d!;",
  ]);

function source() {
  let text = "";
  for (let i = 1 + rng.int(9); i > 0; i--) {
    const kind = rng.int(10);
    if (kind < 4) text += `${statement()}\n`;
    else if (kind < 7) text += `${comment()}\n`;
    else if (kind < 9) text += `${statement()} ${comment()}\n`;
    else {
      const it = comment();
      text += it.startsWith("/*") ? `${it} ${statement()}\n` : `${it}\n`;
    }
    if (rng.int(12) === 0) text += "\n";
  }
  return text;
}

const configuring = () =>
  rng.pick([
    '/* eslint no-debugger: "off" */',
    "/* eslint no-debugger: 0, no-var: 0 */",
    '/* eslint no-var: "error" */',
    '/* eslint no-debugger: "warn", @typescript-eslint/no-non-null-assertion: "off" */',
    '/* eslint no-empty: "error" */ {}',
    "/* eslint no-such-rule: 2 */",
    "/* eslint no-var: [ */",
    '/* eslint no-var: "loud" */',
    "/* eslint-env node */",
    "/* eslint-env */",
    "/* global a */",
    "/* globals a: nonsense */",
    "/* exported a */",
    "// eslint no-var: 0",
  ]);

const basePath = mkdtempSync(join(tmpdir(), "oxlint-directives-"));
try {
  const sources = {};
  for (let i = 0; i < 6000; i++) sources[join(basePath, `${i}.ts`)] = source();
  for (let i = 6000; i < 6400; i++) sources[join(basePath, `${i}.ts`)] = list(configuring, 1, 2).join("\n") + "\n" + source();
  writeFileSync(join(basePath, ".oxlintrc.json"), JSON.stringify(config));
  for (const [path, text] of Object.entries(sources)) writeFileSync(path, text);
  const { stdout } = spawnSync(oxlint, ["--format", "json", "."], { cwd: basePath, maxBuffer: 1 << 28 });
  const expected = Object.fromEntries(Object.keys(sources).map(path => [path, []]));
  for (const { code, message, severity, filename, labels } of JSON.parse(stdout.toString()).diagnostics) {
    const { line, column } = labels[0].span;
    const id = code === undefined ? null : idOf[code];
    expected[join(basePath, filename)].push([
      id,
      severity === "error" ? 2 : 1,
      line,
      column,
      ...(id === null ? [message] : []),
    ]);
  }
  const [theirs, ours] = [stdout.toString(), bunLintPrints(["--format", "json", "."], basePath)].map(reportsOfOxlint);
  const strict = strictly("oxlint directives, by the command line", { show });
  for (const path of Object.keys(sources)) {
    const name = path.slice(basePath.length + 1);
    strict.add(name, { [name]: theirs[name] ?? [] }, { [name]: ours?.[name] ?? [] });
  }
  strict.report();
  const [actual] = runBunLint("project", [{ basePath, flavor: "oxlint", detailed: true, config, sources }]);
  const sorted = rows =>
    [...rows].sort((a, b) => a[2] - b[2] || a[3] - b[3] || (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  const paths = Object.keys(sources);
  report(
    "oxlint directives",
    paths.map(path => ({ code: sources[path] })),
    paths.map(path => sorted(expected[path])),
    paths.map(path =>
      sorted(
        (actual[path] ?? []).map(([id, severity, line, column, message]) => [
          id,
          severity,
          line,
          column,
          ...(id === null ? [message] : []),
        ]),
      ),
    ),
    show,
  );
} finally {
  rmSync(basePath, { recursive: true, force: true });
}
