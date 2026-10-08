// bun sweep.ts <bun-lint executable> <scratch directory> <configuration file> <wide|deep> <n> [flags] [part of a name ..]
//
// Lints every shape at the sizes n and 4n (or --factor times n) with `<bun-lint> cli`, one file at a time in a process of its own with a limit on time and
// on address space, and prints the shapes on which it ends abnormally, and those on which it takes much more than four times as
// long at four times the size. With all rules on and --more, each shape, which was written with some rule in mind, meets all the
// others: that found what the sweeps of some rules on their own shapes had not.
//
//   --more           also the shapes that are each for some rules: see sets.ts
//   --args="a b"     more arguments for the executable, such as --fix-dry-run or --type-aware
//   --jobs=4  --seconds=20  --megabytes=4000
//   --factor=4       the second size is that many times the first
//   --growth=7       what counts as much more than that many times: 1.75 times the factor unless it is given
//   --least=0.3      a run that is shorter than that many seconds at the second size is not looked at
//
// A sweep that finds nothing says something only about the files that were linted. So it counts those that the parser refuses as
// nested too deeply, in which no rule has run. It cannot tell whether a rule has run: have a file on which each must report.
// Times are of use only on a machine that does nothing else.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { shapesOf } from "./sets";

const flags = process.argv.slice(2).filter(it => it.startsWith("--"));
const [binary, scratch, config, kind, size, ...filters] = process.argv.slice(2).filter(it => !it.startsWith("--"));
const flag = (name: string) => flags.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!binary || !scratch || !config || (kind !== "wide" && kind !== "deep") || !(Number(size) > 0)) {
  console.error(
    "usage: bun sweep.ts <bun-lint executable> <scratch directory> <configuration file> <wide|deep> <n> [flags] [part of a name ..]",
  );
  process.exit(2);
}
const [jobs, seconds, megabytes] = [
  Number(flag("jobs") ?? 4),
  Number(flag("seconds") ?? 20),
  Number(flag("megabytes") ?? 4000),
];
const factor = Number(flag("factor") ?? 4);
const [growth, least] = [Number(flag("growth") ?? 1.75 * factor), Number(flag("least") ?? 0.3)];
const more = flag("args")?.split(" ").filter(Boolean) ?? [];
const sizes = [Number(size), factor * Number(size)];

type Run = { seconds: number; end: "linted" | "refused" | string };

async function run(name: string, text: string, n: number): Promise<Run> {
  const directory = join(scratch, `${n}-${name}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), text + "\n");
  const started = performance.now();
  const proc = Bun.spawn({
    cmd: ["sh", "-c", `ulimit -c 0; ulimit -v ${megabytes * 1000}; exec "$0" "$@"`, resolve(binary)].concat([
      "cli",
      "-c",
      resolve(config),
      "--threads",
      "1",
      "-f",
      "unix",
      ...more,
      name,
    ]),
    cwd: directory,
    env: { ...process.env, AGENT: "0", CLAUDECODE: undefined, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "ignore",
    timeout: seconds * 1000,
  });
  // The output can have hundreds of megabytes. Only whether the file was parsed is of interest, which is said first.
  let head = "";
  for await (const chunk of proc.stdout) if (head.length < 4096) head += Buffer.from(chunk).toString("latin1");
  const exitCode = await proc.exited;
  rmSync(directory, { recursive: true, force: true });
  const took = (performance.now() - started) / 1000;
  if (proc.signalCode === "SIGTERM" && took >= seconds) return { seconds: took, end: `more than ${seconds} s` };
  if (proc.signalCode || (exitCode !== 0 && exitCode !== 1))
    return { seconds: took, end: proc.signalCode ?? `exit code ${exitCode}` };
  return { seconds: took, end: head.includes("nested too deeply") ? "refused" : "linted" };
}

const [small, large] = sizes.map(n => shapesOf(kind, n, flags.includes("--more")));
const names = [...small.keys()].filter(name => !filters.length || filters.some(it => name.includes(it)));
const results = new Map<string, [Run, Run]>();
const pending = [...names];
await Promise.all(
  Array.from({ length: jobs }, async () => {
    for (let name = pending.shift(); name !== undefined; name = pending.shift()) {
      results.set(name, [await run(name, small.get(name)!(), sizes[0]), await run(name, large.get(name)!(), sizes[1])]);
    }
  }),
);

const count = (at: 0 | 1, end: string) => names.filter(name => results.get(name)![at].end === end).length;
let found = 0;
for (const name of names) {
  const [a, b] = results.get(name)!;
  const abnormal = [a, b].find(it => it.end !== "linted" && it.end !== "refused");
  const grows = a.end === "linted" && b.end === "linted" && b.seconds >= least && b.seconds > growth * a.seconds;
  if (!abnormal && !grows) continue;
  found++;
  console.log(`${name}: ${a.seconds.toFixed(2)} s -> ${b.seconds.toFixed(2)} s${abnormal ? `, ${abnormal.end}` : ""}`);
}
for (const at of [0, 1] as const) {
  console.log(
    `n = ${sizes[at]}: ${names.length} shapes, ${count(at, "linted")} linted, ${count(at, "refused")} refused by the parser`,
  );
}
console.log(`${found} shapes to look at`);
process.exit(found ? 1 : 0);
