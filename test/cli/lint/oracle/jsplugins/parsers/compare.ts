// Real ESLint against `bun lint` on files that need a parser, a language or a processor of a plugin.
//
//     bun compare.ts [--fix] [--show=3] [--threads=8] <config> <directory> <pattern..> -- <bun lint, as a command>
//
// `<config>` is next to a `node_modules` that has `eslint` (or `ESLINT_DIR` is a checkout of it) and the plugins. Both run in `<directory>` with `-c <config> -f json`,
// with `--fix` also `--fix-dry-run`. Compared for each file: every message and every suppressed message as JSON (ruleId, severity,
// message, line, column, endLine, endColumn, messageId, fix, suggestions, suppressions), `output`, the counts and
// `usedDeprecatedRules`. Prints one line: how many files are identical, and what each run took.

import { dirname, join, relative } from "node:path";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const ours = argv.slice(split + 1);
const flags = argv.slice(0, split).filter(it => it.startsWith("--"));
const [config, directory, ...patterns] = argv.slice(0, split).filter(it => !it.startsWith("--"));
const flag = (name: string, fallback: string) =>
  flags.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const fixes = flags.includes("--fix");
const show = Number(flag("show", "3"));

type Result = { filePath: string; messages: unknown[]; suppressedMessages: unknown[]; output?: string };

async function run(cmd: string[]) {
  const started = performance.now();
  const child = Bun.spawn({ cmd, cwd: directory, stdout: "pipe", stderr: "pipe", env: { ...process.env, AGENT: "0" } });
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const code = await child.exited;
  const seconds = ((performance.now() - started) / 1000).toFixed(2);
  let results: Result[] | null = null;
  try {
    results = JSON.parse(out);
  } catch {}
  return { results, err, code, seconds };
}

const common = ["-c", config, "-f", "json", ...(fixes ? ["--fix-dry-run"] : []), ...patterns];
const eslint = join(process.env.ESLINT_DIR ?? join(dirname(config), "node_modules", "eslint"), "bin", "eslint.js");
const [expected, actual] = [
  await run(["node", eslint, ...common]),
  await run([...ours, "--threads", flag("threads", "8"), ...common]),
];
if (expected.results === null || actual.results === null) {
  console.log(`exit codes ${expected.code} / ${actual.code}`);
  console.log(`eslint: ${expected.err.slice(0, 1500)}\nours: ${actual.err.slice(0, 1500)}`);
  process.exit(expected.results === null && actual.results === null && expected.code === actual.code ? 0 : 1);
}

const byPath = new Map(actual.results.map(it => [it.filePath, it]));
let same = 0;
let messages = 0;
let shown = 0;
for (const theirs of expected.results) {
  messages += theirs.messages.length;
  const mine = byPath.get(theirs.filePath);
  byPath.delete(theirs.filePath);
  // The text of the file is in both.
  const strip = ({ source, ...rest }: any) => JSON.stringify(rest);
  if (mine !== undefined && strip(mine) === strip(theirs)) {
    same++;
    continue;
  }
  if (shown++ >= show) continue;
  console.log(`── ${relative(directory, theirs.filePath)}`);
  if (mine === undefined) {
    console.log("   not linted");
    continue;
  }
  for (const key of Object.keys({ ...theirs, ...mine }) as (keyof Result)[]) {
    if (key === ("source" as string) || JSON.stringify(theirs[key]) === JSON.stringify(mine[key])) continue;
    const [a, b] = [theirs[key], mine[key]];
    if (!Array.isArray(a) || !Array.isArray(b)) {
      console.log(`   ${key}: ${JSON.stringify(a)?.slice(0, 300)}\n   ours: ${JSON.stringify(b)?.slice(0, 300)}`);
      continue;
    }
    const at = a.findIndex((it, i) => JSON.stringify(it) !== JSON.stringify(b[i]));
    const index = at === -1 ? a.length : at;
    console.log(`   ${key}[${index}] of ${a.length} / ${b.length}`);
    console.log(`     eslint: ${JSON.stringify(a[index])?.slice(0, 400)}`);
    console.log(`     ours:   ${JSON.stringify(b[index])?.slice(0, 400)}`);
  }
}
for (const extra of [...byPath.keys()].slice(0, show)) console.log(`── ${relative(directory, extra)}\n   only linted by us`);
const total = expected.results.length;
console.log(
  `${same} / ${total} files identical${byPath.size ? `, ${byPath.size} only linted by us` : ""}, ${messages} messages, exit codes ${expected.code} / ${actual.code}, eslint ${expected.seconds} s, ours ${actual.seconds} s`,
);
process.exit(same === total && byPath.size === 0 && expected.code === actual.code ? 0 : 1);
