// Runs the tests of this repository twice with the repository's own runner (scripts/runner.node.ts: its list of tests, its
// environment, its time limits): as they are, and with a flag put behind every `bun test` and `bun run` that the runner starts.
// A test file that passes as it is and fails with the flag is a program that --aot gets wrong, or one that does what --aot does
// not allow. This takes hours and is not part of `bun test`.
//
//   bun test/aot/whole-suite.ts [--flag=--aot] [--bun=<path>] [--out=<folder>] [--shard=<k>/<n>] [<filter> ..]
//
//   --flag    what is put behind `test` and `run`: `--aot` runs the sources under the rules of --aot
//   --bun     the Bun under test, by default the one that runs this script
//   --out     where the two lists of results go (plain.json, flag.json: what the runner's --results-json writes); by default a temporary folder.
//             A plain.json that is there already is not made again
//   filters   as for the runner: parts of paths under test/
//
// whole-suite.unchecked.txt beside this script names test files that TypeScript rejects. With --aot a type error ends a file before it runs, so
// for the run with the flag each of them gets `// @ts-nocheck` as its first line, and its own text back when the run has ended.
//
// It prints how many of the files that pass as they are also pass with the flag, by folder, and every file that does not with the
// end of what it printed. The exit code is 1 if there is such a file that whole-suite.known.txt beside this script does not name.
import { spawnSync } from "bun";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const words = process.argv.slice(2);
const option = (name: string) => words.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
const filters = words.filter(word => !word.startsWith("--"));
const flag = option("flag") ?? "--aot";
const bun = resolve(option("bun") ?? process.execPath);
const out = resolve(option("out") ?? mkdtempSync(join(tmpdir(), "whole-suite-")));
const [shard, shards] = option("shard")?.split("/") ?? [];
const repository = join(import.meta.dir, "..", "..");
mkdirSync(out, { recursive: true });

type Result = { testPath: string; ok: boolean; status: string; error?: string; stdoutPreview?: string };

function run(name: string, inserted: string): Map<string, Result> {
  const results = join(out, `${name}.json`);
  if (!existsSync(results)) {
    // The runner asks the executable it is given for `process.argv[0]` and goes on with the answer, so the wrapper answers with its own path.
    const wrapper = join(out, `bun-${name}`);
    writeFileSync(
      wrapper,
      `#!/bin/bash
if [ "\${1:-}" = --print ] && [ "\${2:-}" = "process.argv[0]" ]; then echo "${wrapper}"; exit 0; fi
case "\${1:-}" in run|test) command=$1; shift; exec "${bun}" "$command" ${inserted} "$@";; *) exec "${bun}" "$@";; esac
`,
    );
    chmodSync(wrapper, 0o755);
    const sharded = shards ? [`--shard=${shard}`, `--max-shards=${shards}`] : [];
    spawnSync({
      cmd: ["node", "scripts/runner.node.ts", "--quiet", `--exec-path=${wrapper}`, "--retries=0", `--results-json=${results}`, ...sharded, ...filters],
      cwd: repository,
      stdio: ["ignore", "inherit", "inherit"],
    });
  }
  return new Map((JSON.parse(readFileSync(results, "utf8")) as Result[]).map(result => [result.testPath.replaceAll("\\", "/"), result]));
}

const plain = run("plain", "");
const unchecked = readFileSync(join(import.meta.dir, "whole-suite.unchecked.txt"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map(path => join(repository, path));
const texts = unchecked.map(path => readFileSync(path, "utf8"));
let flagged: Map<string, Result>;
try {
  unchecked.forEach((path, index) => writeFileSync(path, "// @ts-nocheck\n" + texts[index]));
  flagged = run("flag", flag);
} finally {
  unchecked.forEach((path, index) => writeFileSync(path, texts[index]));
}

const knownFile = join(import.meta.dir, "whole-suite.known.txt");
const known = new Set(
  (existsSync(knownFile) ? readFileSync(knownFile, "utf8") : "")
    .split("\n")
    .map(line => line.split("#")[0].trim())
    .filter(Boolean),
);

const folders = new Map<string, { passPlain: number; passBoth: number }>();
const lost: Result[] = [];
for (const [path, result] of plain) {
  if (!result.ok) continue;
  const parts = path.replace(/^test\//, "").split("/");
  const folder = parts.slice(0, parts[0] === "js" ? 2 : 1).join("/");
  const count = folders.getOrInsertComputed(folder, () => ({ passPlain: 0, passBoth: 0 }));
  count.passPlain++;
  const other = flagged.get(path);
  if (other?.ok) count.passBoth++;
  else lost.push(other ?? { testPath: path, ok: false, status: "not run" });
}

for (const [folder, { passPlain, passBoth }] of [...folders].sort()) console.log(`${String(passBoth).padStart(5)} of ${String(passPlain).padStart(5)}  ${folder}`);
const total = [...folders.values()].reduce((sum, { passPlain }) => sum + passPlain, 0);
console.log(`${total - lost.length} of the ${total} files that pass as they are pass with ${flag}; ${plain.size} files were run. The results: ${out}`);
const unknown = lost.filter(result => !known.has(result.testPath.replaceAll("\\", "/")));
for (const result of lost) {
  const end = (result.stdoutPreview ?? "").trimEnd().split("\n").slice(-6).join("\n    ");
  console.log(`\n${unknown.includes(result) ? "NEW" : "known"}: ${result.testPath}: ${result.error ?? result.status}\n    ${end}`);
}
for (const path of known) if (flagged.get(path)?.ok) console.log(`\nno longer fails, take it out of whole-suite.known.txt: ${path}`);
process.exit(unknown.length ? 1 : 0);
