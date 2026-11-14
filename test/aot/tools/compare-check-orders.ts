// Builds programs with their files checked in several orders. The type errors must be the same, and so must the intermediate
// representation, which holds the type of everything that is compiled.
//
//   bun test/aot/tools/compare-check-orders.ts [--bun=<bun>] [--jobs=8] [--seed=1] <entry point or folder>..
//
// A folder stands for every main.* below it that has another source file beside or below it. Prints the programs that differ, with
// the first difference in their messages, and how many were compared.
import { Glob } from "bun";
import { existsSync, readFileSync, statSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { availableParallelism, tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";

const flag = (name: string) => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const bun = resolve(flag("bun") ?? process.execPath);
const jobs = Number(flag("jobs") ?? Math.min(8, availableParallelism()));
const seed = Number(flag("seed") ?? 1);
const isSource = (path: string) => /\.[cm]?[jt]sx?$/.test(path) && !path.endsWith(".d.ts");

// Multiplication by an odd number permutes the numbers below 2^32.
const anyOrder = ((Math.imul(0x9e3779b1, 2 * seed + 1) | 1) >>> 0).toString();
const ways: { name: string; words: string[] }[] = [
  { name: "program order", words: ["--aot-threads=1", "--aot-testing=CheckOrder=1"] },
  { name: "last file first", words: ["--aot-threads=1", "--aot-testing=CheckOrder=4294967295"] },
  {
    name: "last file first, each file twice",
    words: ["--aot-threads=1", "--aot-testing=CheckOrder=4294967295", "--aot-testing=DiscardsFirstVisits"],
  },
  { name: `order ${anyOrder}, 4 threads`, words: ["--aot-threads=4", `--aot-testing=CheckOrder=${anyOrder}`] },
];

const programs: string[] = [];
for (const path of process.argv.slice(2).filter(it => !it.startsWith("--"))) {
  if (!statSync(path).isDirectory()) {
    programs.push(resolve(path));
    continue;
  }
  for (const entry of new Glob("**/main.{ts,tsx,mts,cts,js,jsx,mjs,cjs}").scanSync({ cwd: path, dot: false })) {
    if (entry.includes("node_modules")) continue;
    const full = resolve(path, entry);
    const others = new Glob("**/*").scanSync({ cwd: dirname(full), dot: false });
    if ([...others].some(it => isSource(it) && it !== basename(full))) programs.push(full);
  }
}
programs.sort();

const scratch = await mkdtemp(join(tmpdir(), "check-orders-"));
let differing = 0;
let refused = 0;
let next = 0;

async function build(entry: string, at: number, way: (typeof ways)[number]) {
  const out = join(scratch, `${at}.ir`);
  await rm(out, { force: true });
  const flags = /^\/\/ Flags: (.*)$/m.exec(readFileSync(entry, "utf8"))?.[1].split(" ") ?? [];
  const cmd = [bun, "build", "--compile", "--aot", "--aot-testing=NoExecutable", "--aot-testing=TypeErrorsWarn"];
  await using proc = Bun.spawn({
    cmd: [...cmd, `--aot-out=${out}`, ...way.words, ...flags, entry],
    cwd: dirname(entry),
    env: { ...process.env, NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0" },
    stdout: "ignore",
    stderr: "pipe",
    timeout: 300_000,
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const messages = stderr.split("\n").filter(line => !/^\s*\[[\d.]+m?s\]/.test(line));
  const representation = existsSync(out) ? Bun.hash(readFileSync(out)).toString(16) : "none";
  return { exitCode, messages: messages.join("\n"), representation };
}

async function work() {
  while (next < programs.length) {
    const at = next++;
    const first = await build(programs[at], at, ways[0]);
    if (first.representation === "none") refused++;
    for (const way of ways.slice(1)) {
      const other = await build(programs[at], at, way);
      const kinds = (["exitCode", "messages", "representation"] as const).filter(kind => other[kind] !== first[kind]);
      if (kinds.length === 0) continue;
      differing++;
      console.log(`${programs[at]}: ${way.name}: ${kinds.join(", ")}`);
      const [lines, otherLines] = [first.messages.split("\n"), other.messages.split("\n")];
      const line = lines.findIndex((it, index) => it !== otherLines[index]);
      if (kinds.includes("messages")) console.log(`  < ${lines[line]}\n  > ${otherLines[line]}`);
    }
  }
}

await Promise.all(Array.from({ length: jobs }, work));
await rm(scratch, { recursive: true, force: true });
console.log(`${programs.length} programs in ${ways.length} orders: ${differing} differ, ${refused} are refused`);
process.exit(differing === 0 ? 0 : 1);
