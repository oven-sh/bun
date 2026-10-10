// Runs oxlint and `bun lint` on a project that has an `.oxlintrc.json`, and compares what they report for the rules that both
// implement, by (file, line, column, rule), and which files they lint.
//
//   bun oxlint-differential.mjs --project=<directory> --oxlint=<path of oxlint> --bin="<bun-lint> cli" [--show[=rule]] [--status] [-- <arguments for both>]
//
// `--status`: whether the exit code is 0 is compared too, where every diagnostic of oxlint is of a rule that both have.
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

// The rules that `bun lint` has: the harness lists them, Bun itself does with `--rules`.
const rules = new Set(
  bin[1] === "cli"
    ? JSON.parse(spawnSync(bin[0], ["linter", "rules", "--oxlint"], { encoding: "utf8" }).stdout)
    : JSON.parse(spawnSync(bin[0], [...bin.slice(1), "--rules", "-f", "json"], { encoding: "utf8", cwd: project }).stdout).map(it =>
        it.scope === "eslint" ? it.value : it.scope === "typescript" ? `@typescript-eslint/${it.value}` : `${it.scope}/${it.value}`,
      ),
);

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

/** Of oxlint's `json`, which `bun lint` prints too with a configuration of oxlint. */
function tuplesOf(stdout, isOurs) {
  const tuples = [];
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // It has refused the command line or the configuration, or found no file.
    if (isOurs || own.includes("--status")) return { tuples: [], files: 0 };
    console.error("the output of oxlint is not JSON");
    process.exit(2);
  }
  if (Array.isArray(parsed)) {
    console.error("bun lint prints the json of ESLint: it does not take the configuration for oxlint's");
    process.exit(2);
  }
  for (const diagnostic of parsed.diagnostics ?? []) {
    const rule = ruleOfOxlint(diagnostic.code);
    const span = diagnostic.labels?.[0]?.span;
    if (!span || (diagnostic.code && !rule)) continue;
    const file = path.resolve(project, diagnostic.filename);
    // Without a code: a syntax error, or a comment that disables nothing.
    tuples.push({ file: path.relative(project, file), ...position(file, span), length: span.length, rule: rule ?? "(none)" });
  }
  return { tuples, files: parsed.number_of_files };
}

const theirs = run([oxlint], ["--format=json", ...extra]);
const ours = run(bin, ["--format=json", ...extra]);
const expected = tuplesOf(theirs.stdout, false);
const actual = tuplesOf(ours.stdout, true).tuples;

// The rules of a plugin in JavaScript are not in the list. Both have them if `bun lint` reports anything of that plugin.
const prefixes = new Set(actual.map(it => it.rule.split("/")[0]).filter(it => it !== "@typescript-eslint"));
// `TS2322`: what the type checker reports with `--type-check`.
const isShared = rule =>
  rule === "(none)" || /^@typescript-eslint\/TS\d+$/.test(rule) || rules.has(rule) || rules.has(`@typescript-eslint/${rule}`) || (rule.includes("/") && prefixes.has(rule.split("/")[0]));
// The second diagnostic of a rule at a position is another key than the first: `a!.b!` has two at `a`.
const keyed = tuples => {
  const seen = new Map();
  return new Map(
    tuples.map(it => {
      const key = `${it.file}:${it.line}:${it.column}+${it.length} ${canonical(it.rule)}`;
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
if (own.includes("--status") && notShared.size === 0 && (theirs.status === 0) !== (ours.status === 0)) {
  console.log(`! exit code: oxlint ${theirs.status}, bun lint ${ours.status}`);
  process.exit(1);
}
process.exit(differences.length ? 1 : 0);
