// Runs oxlint and `bun lint` on a project that has an `.oxlintrc.json`, and compares what they report for the rules that both
// implement, by (file, line, column, rule), and which files they lint.
//
//   bun oxlint-differential.mjs --project=<directory> --oxlint=<path of oxlint> --bin="<bun-lint> cli" [--show[=rule]] [-- <arguments for both>]
//
// The project can be confidential, so this script is built to leak nothing of its text:
// - It writes no file. It has no option to.
// - The output of both linters stays in memory. Only the path, the line, the column and the name of the rule are taken from it.
//   Messages, which quote the code, and source excerpts are never kept or printed, not even when a line cannot be parsed.
// - Neither linter is asked for a format that has the source text, and `--fix` and the like are refused.
// - Without `--show` only counts are printed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dashes = process.argv.indexOf("--");
const own = process.argv.slice(2, dashes < 0 ? undefined : dashes);
const extra = dashes < 0 ? [] : process.argv.slice(dashes + 1);
const flag = name => own.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const project = path.resolve(flag("project"));
const oxlint = path.resolve(flag("oxlint"));
const bin = flag("bin").split(" ");
const show = own.includes("--show") ? true : flag("show");

const forbidden = /^(--fix|--output-file|-o$|-o=|--format|-f$|-f=|--print-config|--debug|--init|--suppress)/;
if (extra.some(it => forbidden.test(it))) {
  console.error("refused: an argument writes files or chooses a format");
  process.exit(2);
}

function run(command, args) {
  const started = performance.now();
  const result = spawnSync(command[0], [...command.slice(1), ...args], {
    cwd: project,
    encoding: "utf8",
    maxBuffer: 1 << 30,
    env: { ...process.env, NO_COLOR: "1", AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined },
  });
  return { stdout: result.stdout ?? "", status: result.status, ms: performance.now() - started };
}

const rules = new Set(JSON.parse(spawnSync(bin[0], ["linter", "rules"], { encoding: "utf8" }).stdout));

/** `eslint(no-debugger)`, `typescript-eslint(no-explicit-any)` as ESLint calls them. */
function ruleOfOxlint(code) {
  const match = /^([\w-]+)\(([\w-]+)\)$/.exec(code ?? "");
  if (!match) return null;
  if (match[1] === "eslint") return match[2];
  if (match[1] === "typescript-eslint" || match[1] === "typescript") return `@typescript-eslint/${match[2]}`;
  return `${match[1]}/${match[2]}`;
}

/** oxlint runs the extension of typescript-eslint under the name of ESLint's rule. */
const canonical = rule => (rule.startsWith("@typescript-eslint/") ? rule.slice("@typescript-eslint/".length) : rule);

/**
 * oxlint counts columns in bytes and does not take U+2028 for the end of a line. ESLint counts UTF-16 code units and does. The
 * offset, which is in bytes, means the same to both. The text is read for that only, and dropped with the next file.
 */
let last = { file: null, bytes: null };
function position(file, span) {
  if (last.file !== file) last = { file, bytes: fs.readFileSync(file) };
  const before = last.bytes.subarray(0, span.offset).toString("utf8").replace(/^\uFEFF/, "");
  const lines = before.split(/\r\n|[\r\n\u2028\u2029]/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function tuplesOfOxlint(stdout) {
  const tuples = [];
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    console.error("the output of oxlint is not JSON");
    process.exit(2);
  }
  for (const diagnostic of parsed.diagnostics ?? []) {
    const rule = ruleOfOxlint(diagnostic.code);
    const span = diagnostic.labels?.[0]?.span;
    if (!rule || !span) continue;
    const file = path.resolve(project, diagnostic.filename);
    tuples.push({ file: path.relative(project, file), ...position(file, span), rule });
  }
  return { tuples, files: parsed.number_of_files };
}

function tuplesOfBun(stdout) {
  const tuples = [];
  // `path:line:column: message [Error/rule]`. A message can have line breaks: only lines of this form count.
  for (const line of stdout.split("\n")) {
    const start = /^(.+?):(\d+):(\d+): /.exec(line);
    const end = /\[(?:Error|Warning)\/([@\w/-]+)\]$/.exec(line);
    if (!start) continue;
    tuples.push({
      file: path.relative(project, start[1]),
      line: +start[2],
      column: +start[3],
      rule: end?.[1] ?? "(none)",
    });
  }
  return tuples;
}

const theirs = run([oxlint], ["--format=json", ...extra]);
const ours = run(bin, ["--format=unix", ...extra]);
const expected = tuplesOfOxlint(theirs.stdout);
const actual = tuplesOfBun(ours.stdout);

const isShared = rule => rules.has(rule) || rules.has(`@typescript-eslint/${rule}`);
// The second diagnostic of a rule at a position is another key than the first: `a!.b!` has two at `a`.
const keyed = tuples => {
  const seen = new Map();
  return new Map(
    tuples.map(it => {
      const key = `${it.file}:${it.line}:${it.column} ${canonical(it.rule)}`;
      const nth = (seen.get(key) ?? 0) + 1;
      seen.set(key, nth);
      return [nth === 1 ? key : `${key} (${nth})`, it];
    }),
  );
};
const expectedKeys = keyed(expected.tuples.filter(it => isShared(it.rule)));
const actualKeys = keyed(actual);

const byRule = new Map();
const count = (rule, field) => {
  const entry = byRule.get(rule) ?? { same: 0, onlyOxlint: 0, onlyBun: 0 };
  entry[field]++;
  byRule.set(rule, entry);
};
const differences = [];
for (const [k, it] of expectedKeys) {
  if (actualKeys.has(k)) count(canonical(it.rule), "same");
  else {
    count(canonical(it.rule), "onlyOxlint");
    differences.push(`- ${k}`);
  }
}
for (const [k, it] of actualKeys) {
  if (!expectedKeys.has(k)) {
    count(canonical(it.rule), "onlyBun");
    differences.push(`+ ${k}`);
  }
}

console.log(
  `oxlint: exit ${theirs.status}, ${expected.files} files, ${expected.tuples.length} diagnostics, ${expectedKeys.size} of rules that bun lint has, ${theirs.ms.toFixed(0)} ms`,
);
console.log(`bun lint: exit ${ours.status}, ${actual.length} diagnostics, ${ours.ms.toFixed(0)} ms`);
const notShared = new Map();
for (const it of expected.tuples) if (!isShared(it.rule)) notShared.set(it.rule, (notShared.get(it.rule) ?? 0) + 1);
console.log(
  `rules of oxlint that bun lint does not have: ${[...notShared].map(([rule, n]) => `${rule} (${n})`).join(", ") || "none"}`,
);
console.table(Object.fromEntries([...byRule].sort()));
if (show) {
  for (const line of differences.sort()) if (show === true || line.includes(` ${show}`)) console.log(line);
}
process.exit(differences.length ? 1 : 0);
