import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadFeatures } from "../../../scripts/build/trim/features";
import { aQuarterOfTheMemory, compareAll, coresOfTheMachine, described, inJail, jailOfThisMachine, Tally, type Program, type Result, type Settings } from "./compare";
import { aotPrograms, benches, bunTests, documentedExamples, jsTests, listed, nodeTests, repository, test262 } from "./corpora";
import { programsOfEveryLocale } from "./locales";
import { programsThatNameEverything, programsThatReachNames, reflect } from "./reach-names";

const usage = `bun test/aot/trimmed-against-whole/run.ts [options] [entry files]

Builds each program twice, with \`bun build --compile --aot\` and with --trim as well, runs both executables
with the same arguments, environment, standard input and a fresh working directory, and compares standard output, standard
error, the exit code and the signal. Where they differ, the whole executable runs twice more. A program that does not compile,
does not end, or whose whole executable does not do the same each time is set aside and counted.

A COMPILED PROGRAM THAT STARTS process.execPath STARTS ITSELF, and most tests that do so then do it again, without end. So on Linux
the executables run in transient systemd units, as many as there are jobs, each with a process tree of its own (unshare --pid) and one
program in it at a time: nothing a program starts can leave them, detached or not, and all of it is killed when its first process ends
or the time is up; the only network there is a loopback of their own. The units last for the whole run: making and ending namespaces
for every program holds up everything else on the machine that makes one. Where systemd-run cannot be used there is only the process tree. Without a cgroup, the tests of Node.js and Bun, bench/, listed files and every program that names child_process,
cluster, Worker, execPath, spawn, fork or exec are set aside and counted.

  --corpus <name>       test262 | jstests | node | bun-tests | benches | docs | aot-programs | locales | every-name | names; may be given several times
                        locales: each service of Intl, and each method that depends on the locale or the time zone, alone in a program,
                        for every locale, time zone and calendar, and under several settings of LANG and TZ
                        every-name: each name that a whole executable finds from globalThis and the built-in modules, spelled out
                        names: random walks to such names, by constant and by computed keys; a program that differs is shrunk
  --test262 <folder>    a checkout of https://github.com/tc39/test262 (WebKit has one in JSTests/test262)
  --jstests <folder>    WebKit's JSTests
  --list <file>         entry files, one to a line
  --filter <regex>      only programs whose "corpus name" matches
  --part <i>/<n>        the i-th of n parts, by a hash of the name
  --sample <n>          about n programs of each corpus, by a hash of the name and --seed
  --shuffle             in the order of a hash of the name, so that a run that is cut short has seen a bit of everything
  --seed <text>         the seed of --sample and of the corpus "names" (default 1)
  --count <n>           how many programs the corpus "names" generates (default 200)
  --bun <path>          the Bun that builds (default: the one that runs this script)
  --features <folder>   the checkout that Bun was built from: its src/trim/features is read (default: this repository)
  --cores <set>         Linux: the cores that may be used, as taskset has them: 0-15 or 0,2,8-11. Every program is built and run on
                        one of them alone, whatever number of threads a build starts
  --jobs <n>            programs at a time (default: one for each of --cores, or one for every two cores of the machine)
  --highest-load <n>    no program is started while the load of the last minute is at or above this (default: the cores of the
                        machine), or while less than a quarter of the memory is available
  --most-processes <n>  when this user has more processes than this, every running program is ended and the run stops (default 2000)
  --scratch <folder>    where executables are built and run, and removed again (default: /dev/shm or the temporary directory)
  --report <file>       one line of JSON for each program, appended; programs that are in it already are not run again
  --kept <folder>       where the sources of generated programs that differ are kept (default: <report>.kept)
  --env <NAME=value>    set where the executables run and where they are built; may be given several times
  --run-seconds <n>     (default 20)   --build-seconds <n>  (default 180)
  --no-feature-search   do not look for the feature whose absence makes a difference
  --in-jail             only run the command that follows as an executable under test is run, and print the line that starts it
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "corpus": { type: "string", multiple: true, default: [] },
    "test262": { type: "string" },
    "jstests": { type: "string" },
    "list": { type: "string" },
    "filter": { type: "string" },
    "part": { type: "string" },
    "sample": { type: "string" },
    "shuffle": { type: "boolean", default: false },
    "seed": { type: "string", default: "1" },
    "count": { type: "string", default: "200" },
    "bun": { type: "string", default: process.execPath },
    "features": { type: "string", default: repository },
    "cores": { type: "string" },
    "jobs": { type: "string" },
    "highest-load": { type: "string" },
    "most-processes": { type: "string", default: "2000" },
    "scratch": { type: "string" },
    "report": { type: "string" },
    "kept": { type: "string" },
    "env": { type: "string", multiple: true, default: [] },
    "run-seconds": { type: "string", default: "20" },
    "build-seconds": { type: "string", default: "180" },
    "no-feature-search": { type: "boolean", default: false },
    "in-jail": { type: "boolean", default: false },
    "help": { type: "boolean", default: false },
  },
});

if (values["in-jail"]) {
  const launch = inJail(jailOfThisMachine(), positionals, { cwd: process.cwd(), env: { PATH: process.env.PATH }, seconds: Number(values["run-seconds"]), core: values.cores?.split(/[-,]/)[0] });
  console.log(launch.join(" "));
  process.exit(Bun.spawnSync({ cmd: launch, stdin: "ignore", stdout: "inherit", stderr: "inherit" }).exitCode);
}

if (values.help || (values.corpus.length === 0 && positionals.length === 0 && !values.list)) {
  console.log(usage);
  process.exit(values.help ? 0 : 1);
}

const model = loadFeatures(resolve(values.features));

const needs = (option: "test262" | "jstests") => {
  if (!values[option]) throw new Error(`--corpus ${option} needs --${option} <folder>`);
  return resolve(values[option]);
};

const corpora: Record<string, () => Program[]> = {
  "test262": () => test262(needs("test262")),
  "jstests": () => jsTests(needs("jstests")),
  "node": nodeTests,
  "bun-tests": bunTests,
  "benches": benches,
  "aot-programs": aotPrograms,
  "docs": documentedExamples,
  "locales": programsOfEveryLocale,
  "every-name": () => programsThatNameEverything(reflect(values.bun)),
  "names": () => programsThatReachNames(reflect(values.bun), values.seed, Number(values.count)),
};

let programs: Program[] = listed(positionals);
if (values.list) programs.push(...listed(readFileSync(values.list, "utf8").split("\n").filter(line => line.trim())));
for (const corpus of values.corpus) {
  if (!corpora[corpus]) throw new Error(`no corpus is called ${corpus}`);
  programs.push(...corpora[corpus]());
}

const hashOf = (program: Program, salt = "") => Number(BigInt(Bun.hash(`${salt}${program.corpus} ${program.name}`)) % 1_000_003n);
if (values.filter) {
  const filter = new RegExp(values.filter);
  programs = programs.filter(program => filter.test(`${program.corpus} ${program.name}`));
}
if (values.part) {
  const [part, parts] = values.part.split("/").map(Number);
  programs = programs.filter(program => hashOf(program) % parts === part - 1);
}
if (values.sample) {
  const sizes = Map.groupBy(programs, program => program.corpus);
  programs = programs.filter(program => hashOf(program, values.seed) / 1_000_003 < Number(values.sample) / sizes.get(program.corpus)!.length);
}
if (values.shuffle) programs.sort((one, other) => hashOf(one, values.seed) - hashOf(other, values.seed));

const tally = new Tally();
const report = values.report && resolve(values.report);
if (report && existsSync(report)) {
  const done = new Set<string>();
  for (const line of readFileSync(report, "utf8").split("\n").filter(line => line)) {
    const result: Result = JSON.parse(line);
    done.add(`${result.corpus} ${result.name}`);
    tally.add(result);
  }
  programs = programs.filter(program => !done.has(`${program.corpus} ${program.name}`));
  console.log(`${done.size} programs are in ${report} already`);
}

const cores = values.cores?.split(",").flatMap(range => {
  const [first, last = first] = range.split("-").map(Number);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
});
const scratch = join(resolve(values.scratch ?? (existsSync("/dev/shm") ? "/dev/shm" : tmpdir())), `trimmed-against-whole-${process.pid}`);
const settings: Settings = {
  bun: resolve(values.bun),
  scratch,
  kept: resolve(values.kept ?? (report ? `${report}.kept` : join(tmpdir(), "trimmed-against-whole-kept"))),
  model,
  jobs: Number(values.jobs) || cores?.length || Math.max(1, coresOfTheMachine() >> 1),
  cores,
  highestLoad: Number(values["highest-load"]) || coresOfTheMachine(),
  leastMemory: aQuarterOfTheMemory(),
  mostProcesses: Number(values["most-processes"]),
  jail: jailOfThisMachine(),
  buildSeconds: Number(values["build-seconds"]),
  runSeconds: Number(values["run-seconds"]),
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, GOMAXPROCS: "2", WTF_numberOfProcessorCores: "1", ...Object.fromEntries(values.env.map(pair => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)])) },
  buildFlags: [],
  findsFeature: !values["no-feature-search"],
};

mkdirSync(scratch, { recursive: true });
console.log(`the jail: ${settings.jail}: ${inJail(settings.jail, ["<program>"], { cwd: "<folder>", env: { NAME: "value" }, seconds: settings.runSeconds, core: cores && String(cores[0]) }).join(" ")}`);
console.log(`${programs.length} programs, ${settings.jobs} at a time${values.cores ? ` on the cores ${values.cores}` : ""}, while the load is under ${settings.highestLoad}, in ${scratch}, built by ${settings.bun}`);
let finished = 0;
let differing = 0;
try {
  await compareAll(programs, settings, result => {
    tally.add(result);
    if (report) appendFileSync(report, JSON.stringify(result) + "\n");
    if (result.verdict === "differs") {
      differing++;
      console.log(described(result));
    }
    if (++finished % 500 === 0) console.log(`${finished} of ${programs.length}\n${tally}`);
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(String(tally));
console.log("TRIMMED-AGAINST-WHOLE-DONE");
process.exit(differing > 0 ? 1 : 0);
