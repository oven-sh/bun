import { $ } from "bun";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

export interface Project {
  name: string;
  repository: string;
  commit: string;
  directory: string;
  tsconfig: string | null;
  entryPoint: string;
  kind: "application" | "cli" | "framework" | "library";
}

interface Run {
  exitCode: number;
  signal: string | null;
  output: string;
  seconds: number;
  peakMegabytes: number;
}

export interface Result {
  name: string;
  installed?: boolean;
  types?: { tsc: number; bunCheck: number; onlyTsc: string[]; onlyBunCheck: string[] };
  build?: { stock: Built; aot: Built };
  tests?: Compared;
  compiled?: Compared;
}

interface Built {
  exitCode: number;
  signal: string | null;
  seconds: number;
  peakMegabytes: number;
  bytes: number;
  firstErrors: string[];
}

export interface Compared {
  plain: Counts;
  aot: Counts;
  unsteady: number;
  failedOnlyUnderAot: string[];
  neverReportedUnderAot: string[];
  filesRefused: number;
  typeErrors: number;
  causes: { tests: number; message: string; place: string }[];
  filesNotBuilt?: { file: string; error: string }[];
  filesEndedBySignal?: { file: string; signal: string }[];
  filesBuiltUnchecked?: { file: string; unchecked: string[] }[];
  passOnlyInCompany?: number;
}

interface Counts {
  pass: number;
  fail: number;
  skip: number;
  exitCode: number;
  signal: string | null;
  seconds: number;
  peakMegabytes: number;
}

const here = import.meta.dir;
export const projects: Project[] = JSON.parse(readFileSync(join(here, "projects.json"), "utf8"));

const environment = {
  PATH: "/usr/bin:/bin",
  NO_COLOR: "1",
  BUN_ENABLE_CRASH_REPORTING: "0",
  DO_NOT_TRACK: "1",
  ...(process.env.ASAN_OPTIONS && { ASAN_OPTIONS: process.env.ASAN_OPTIONS }),
};

export class Runner {
  constructor(
    readonly work: string,
    readonly bun: string,
    readonly tsc: string | undefined,
    readonly usesJail: boolean,
    readonly secondsPerStep = 900,
    readonly filesAtATime = 4,
  ) {
    for (const folder of ["sources", "cache", "home", "scratch", "empty"]) mkdirSync(join(work, folder), { recursive: true });
  }

  sourceOf(project: Project) {
    return join(this.work, "sources", project.repository.replace("/", "--"));
  }

  async spawn(project: Project, cwd: string, cmd: string[], isOnline = false): Promise<Run> {
    const source = this.sourceOf(project);
    const scratch = join(this.work, "scratch", `${project.name}.${process.pid}.${Math.random().toString(36).slice(2)}`);
    const isJailed = this.usesJail && !isOnline;
    const home = join(this.work, "home");
    const visible = [this.bun, this.tsc && dirname(this.tsc), join(this.work, "empty")].filter(Boolean).join(":");
    const inFolder = ["/bin/sh", "-c", 'cd "$0" && exec "$@"', cwd, ...cmd];
    const started = performance.now();
    const child = Bun.spawn({
      cmd: isJailed ? ["bash", join(here, "jail.sh"), source, scratch, "/usr/bin/env", "HOME=/tmp/home", "TMPDIR=/tmp/tmp", ...inFolder] : inFolder,
      env: { ...environment, HOME: isJailed ? homedir() : home, TMPDIR: home, SEE: visible, BUN_INSTALL_CACHE_DIR: join(this.work, "cache") },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: this.secondsPerStep * 1000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    if (isJailed) await $`chmod -R u+rwx ${scratch}`.nothrow().quiet();
    rmSync(scratch, { recursive: true, force: true });
    return {
      exitCode,
      signal: child.signalCode ?? (exitCode > 128 ? `signal ${exitCode - 128}` : null),
      output: stdout + stderr,
      seconds: (performance.now() - started) / 1000,
      peakMegabytes: Math.round((child.resourceUsage()?.maxRSS ?? 0) / (1024 * 1024)),
    };
  }

  async fetch(project: Project) {
    const source = this.sourceOf(project);
    if (!existsSync(join(source, ".git"))) {
      mkdirSync(source, { recursive: true });
      await $`git init -q && git remote add origin https://github.com/${project.repository} && git fetch -q --depth 1 origin ${project.commit} && git -c advice.detachedHead=false checkout -q FETCH_HEAD`.cwd(source);
    }
    if (existsSync(join(source, "node_modules"))) return true;
    return (await this.spawn(project, source, [this.bun, "install", "--ignore-scripts"], true)).exitCode === 0;
  }

  async compareTypes(project: Project): Promise<Result["types"]> {
    if (!this.tsc || !project.tsconfig) return undefined;
    const source = this.sourceOf(project);
    const config = join(source, project.directory, project.tsconfig);
    const builds = readFileSync(config, "utf8").includes('"references"');
    const empty = join(this.work, "empty");
    const theirs = await this.spawn(project, empty, builds ? [this.tsc, "-b", config, "--pretty", "false"] : [this.tsc, "-p", config, "--noEmit", "--pretty", "false"]);
    const ours = await this.spawn(project, empty, [this.bun, "check", ...(builds ? ["-b"] : []), "-p", config, "--no-pretty", "--all"]);
    const [tsc, bunCheck] = [diagnosticsIn(theirs.output, source), diagnosticsIn(ours.output, source)];
    return { tsc: tsc.size, bunCheck: bunCheck.size, onlyTsc: [...tsc.difference(bunCheck)], onlyBunCheck: [...bunCheck.difference(tsc)] };
  }

  async build(project: Project): Promise<Result["build"]> {
    const entryPoint = join(this.sourceOf(project), project.directory, project.entryPoint);
    const one = async (flags: string[]): Promise<Built> => {
      const outfile = this.usesJail ? "/tmp/executable" : join(this.work, "scratch", `${project.name}.executable`);
      const size = ["/bin/sh", "-c", '"$@"; code=$?; stat -c "SIZE %s" "$0" 2> /dev/null || stat -f "SIZE %z" "$0" 2> /dev/null; exit $code', outfile];
      const run = await this.spawn(project, join(this.work, "empty"), [...size, this.bun, "build", "--compile", ...flags, "--no-macros", entryPoint, "--outfile", outfile]);
      rmSync(outfile, { force: true });
      return {
        exitCode: run.exitCode,
        signal: run.signal,
        seconds: run.seconds,
        peakMegabytes: run.peakMegabytes,
        bytes: Number(/^SIZE (\d+)$/m.exec(run.output)?.[1] ?? 0),
        firstErrors: run.output.split("\n").filter(line => /^(error|panic)\b/.test(line)).slice(0, 5),
      };
    };
    return { stock: await one([]), aot: await one(["--aot"]) };
  }

  async compareTests(project: Project): Promise<Compared> {
    const source = this.sourceOf(project);
    const cwd = join(source, project.directory);
    const test = (flags: string[]) => this.spawn(project, cwd, [this.bun, "test", ...flags, "--timeout", "60000"]);
    const [first, second, aot] = [await test([]), await test([]), await test(["--aot"])];
    return compare(readTests(first, source), readTests(second, source), readTests(aot, source));
  }

  async compareCompiledTests(project: Project): Promise<Compared> {
    const source = this.sourceOf(project);
    const cwd = join(source, project.directory);
    const test = (flags: string[]) => this.spawn(project, cwd, [this.bun, "test", ...flags, "--timeout", "60000"]);
    const [first, second] = [readTests(await test([]), source), readTests(await test([]), source)];
    const waiting = [...new Set([...first.verdicts].filter(([, verdict]) => verdict === "pass").map(([name]) => name.slice(0, name.indexOf(" > "))))];
    const all: Tests = { run: { exitCode: 0, signal: null, output: "", seconds: 0, peakMegabytes: 0 }, verdicts: new Map(), errors: new Map(), filesRefused: 0, typeErrors: 0, source };
    const [filesNotBuilt, filesEndedBySignal]: [Compared["filesNotBuilt"] & {}, Compared["filesEndedBySignal"] & {}] = [[], []];
    const filesBuiltUnchecked: Compared["filesBuiltUnchecked"] & {} = [];
    let passOnlyInCompany = 0;
    // Type errors stop a build. The jail throws away what is written, so there the files that the errors name can be marked as unchecked, and the test file runs as compiled code all the same.
    const mark = `bun=$1; test=$2; shift 2; for file; do sed -i '1s;^;// @ts-nocheck\\n;' "$file"; done; exec "$bun" test --debug-aot "$test" --timeout 60000`;
    const worker = async () => {
      for (let file; (file = waiting.shift()); ) {
        let one = readTests(await test(["--debug-aot", "./" + file]), source);
        const unchecked = new Set<string>();
        for (let round = 0; this.usesJail && round < 5 && one.verdicts.size === 0 && !one.run.signal; round++) {
          const named = new Set(one.run.output.matchAll(/^error: TS\d+: [^]*?\n +at (\/.+?):\d+:\d+$/gm).map(match => match[1]));
          if (named.isSubsetOf(unchecked)) break;
          for (const path of named) unchecked.add(path);
          one = readTests(await this.spawn(project, cwd, ["/bin/sh", "-c", mark, "sh", this.bun, "./" + file, ...unchecked]), source);
        }
        if (unchecked.size && one.verdicts.size) filesBuiltUnchecked.push({ file, unchecked: [...unchecked].map(path => path.replace(source + "/", "")) });
        // The plain runs have all files in one process. A test that needs what another file left behind fails alone in plain Bun too, and does not count.
        const lost = [...first.verdicts].filter(([name, verdict]) => verdict === "pass" && name.startsWith(file + " > ") && one.verdicts.get(name) !== "pass");
        const alone = lost.length ? readTests(await test(["./" + file]), source) : undefined;
        for (const [name] of lost) {
          if (alone!.verdicts.get(name) === "pass") continue;
          first.verdicts.delete(name);
          passOnlyInCompany++;
        }
        for (const [name, verdict] of one.verdicts) all.verdicts.set(name, verdict);
        for (const [name, block] of one.errors) all.errors.set(name, block);
        all.typeErrors += one.typeErrors;
        all.run.seconds += one.run.seconds;
        all.run.peakMegabytes = Math.max(all.run.peakMegabytes, one.run.peakMegabytes);
        all.run.exitCode = Math.max(all.run.exitCode, one.run.exitCode);
        if (one.run.signal) filesEndedBySignal.push({ file, signal: one.run.signal });
        else if (one.verdicts.size === 0) filesNotBuilt.push({ file, error: one.run.output.split("\n").find(line => /error|panic/i.test(line))?.slice(0, 300) ?? "(no message)" });
        all.run.signal ??= one.run.signal;
      }
    };
    await Promise.all(Array.from({ length: this.filesAtATime }, worker));
    return { ...compare(first, second, all), filesNotBuilt, filesEndedBySignal, filesBuiltUnchecked, passOnlyInCompany };
  }
}

function diagnosticsIn(output: string, source: string) {
  const found = new Set<string>();
  for (const line of output.split("\n")) {
    const match = /^(\S+?)\((\d+),(\d+)\): error (TS\d+)/.exec(line) ?? /^()()()error (TS\d+)/.exec(line);
    if (!match) continue;
    const path = match[1].replace(/^(\.\.\/)+/, "/").replace(source + "/", "").replace(/^.*\/lib\/(lib\.[^/]+)$/, "$1").replace(/^bundled:\/\/\/libs\//, "");
    found.add(`${path}(${match[2]},${match[3]}): ${match[4]}`);
  }
  return found;
}

interface Tests {
  run: Run;
  verdicts: Map<string, string>;
  errors: Map<string, string[]>;
  filesRefused: number;
  typeErrors: number;
  source: string;
}

export function readTests(run: Run, source: string): Tests {
  const [verdicts, errors, seen] = [new Map<string, string>(), new Map<string, string[]>(), new Map<string, number>()];
  let [file, block, filesRefused, typeErrors] = ["", [] as string[], 0, 0];
  for (const line of run.output.split("\n")) {
    if (/^\d+ tests? (failed|skipped):$/.test(line) || /^ *\d+ pass$/.test(line)) break;
    const header = /^(\S.*\.[cm]?[jt]sx?):$/.exec(line);
    if (header) {
      [file, block] = [header[1], []];
      continue;
    }
    if (!file) {
      if (/(\): |^)error TS\d+/.test(line)) typeErrors++;
      continue;
    }
    if (line.startsWith("error: bun test --aot does not run this file")) filesRefused++;
    const judged = /^\((pass|fail|skip|todo)\) (.*?)(?: \[[0-9.]+(?:ms|s|us|µs)\])?$/.exec(line);
    if (!judged) {
      block.push(line);
      continue;
    }
    const name = `${file} > ${judged[2]}`;
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    const key = count > 1 ? `${name} #${count}` : name;
    verdicts.set(key, judged[1]);
    if (judged[1] === "fail") errors.set(key, block);
    block = [];
  }
  return { run, verdicts, errors, filesRefused, typeErrors, source };
}

function countsOf(tests: Tests): Counts {
  const count = (verdict: string) => [...tests.verdicts.values()].filter(it => it === verdict).length;
  const { exitCode, signal, seconds, peakMegabytes } = tests.run;
  return { pass: count("pass"), fail: count("fail"), skip: count("skip"), exitCode, signal, seconds, peakMegabytes };
}

function causeOf(block: string[], source: string) {
  const message = block.find(line => /^(\w*Error|error|panic)\b.*:/.test(line)) ?? "(no message)";
  const frames = block.flatMap(line => (line.trim().startsWith("at ") ? (/\(?(\/[^():]+:\d+):\d+\)?$/.exec(line.trim())?.[1] ?? []) : []));
  const place = frames.find(frame => frame.startsWith(source) && !frame.includes("/node_modules/")) ?? frames[0] ?? "";
  return { message: message.replace(/ \(bun compile[^)]*\)/, " [--aot]").replace(/\d+/g, "N").replace(/"[^"]*"/g, '".."'), place: place.replace(source + "/", "") };
}

export function compare(first: Tests, second: Tests, aot: Tests): Compared {
  const steady = [...first.verdicts].filter(([name, verdict]) => second.verdicts.get(name) === verdict);
  const passing = steady.filter(([, verdict]) => verdict === "pass").map(([name]) => name);
  const failedOnlyUnderAot = passing.filter(name => aot.verdicts.get(name) === "fail");
  const causes = new Map<string, { tests: number; message: string; place: string }>();
  for (const name of failedOnlyUnderAot) {
    const cause = causeOf(aot.errors.get(name) ?? [], aot.source);
    const key = `${cause.message} @ ${cause.place}`;
    causes.set(key, { ...cause, tests: (causes.get(key)?.tests ?? 0) + 1 });
  }
  return {
    plain: countsOf(first),
    aot: countsOf(aot),
    unsteady: first.verdicts.size - steady.length,
    failedOnlyUnderAot,
    neverReportedUnderAot: passing.filter(name => !aot.verdicts.has(name)),
    filesRefused: aot.filesRefused,
    typeErrors: aot.typeErrors,
    causes: [...causes.values()].sort((a, b) => b.tests - a.tests),
  };
}

export function rowOf(result: Result) {
  const { types, build, tests, compiled } = result;
  const built = (it: Built) => (it.signal ? it.signal : it.exitCode ? `exit ${it.exitCode}` : `${it.seconds.toFixed(1)} s, ${it.peakMegabytes} MB`);
  return [
    result.name,
    result.installed === false ? "not installed" : "",
    types ? `${types.tsc} | ${types.bunCheck} (${types.onlyTsc.length + types.onlyBunCheck.length} differ)` : "",
    build ? `${built(build.stock)} | ${built(build.aot)}` : "",
    tests ? `${tests.plain.pass} | ${tests.aot.pass}` : "",
    tests ? `${tests.failedOnlyUnderAot.length} failed, ${tests.neverReportedUnderAot.length} never reported, ${tests.filesRefused} files refused` : "",
    tests?.aot.signal ?? tests?.causes[0]?.message ?? "",
    compiled ? `${compiled.plain.pass} | ${compiled.aot.pass}` : "",
    compiled ? `${compiled.failedOnlyUnderAot.length} failed, ${compiled.neverReportedUnderAot.length} never reported, ${compiled.filesNotBuilt!.length} files not built, ${compiled.filesBuiltUnchecked!.length} built with files unchecked, ${compiled.filesEndedBySignal!.length} files ended by a signal` : "",
    compiled?.filesEndedBySignal![0]?.file ?? compiled?.causes[0]?.message ?? "",
  ].join(" | ");
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      only: { type: "string", default: "." },
      steps: { type: "string", default: "fetch,types,build,tests" },
      jobs: { type: "string", default: String(Math.max(1, availableParallelism() >> 2)) },
      bun: { type: "string", default: process.execPath },
      tsc: { type: "string" },
      "no-jail": { type: "boolean", default: false },
      "files-at-a-time": { type: "string", default: "4" },
      results: { type: "string", default: "results.json" },
    },
  });
  if (!positionals[0]) {
    console.error("usage: bun run.ts <work folder> [--only <regex>] [--steps fetch,types,build,tests,compiled] [--jobs <n>] [--files-at-a-time <n>] [--bun <path>] [--tsc <path>] [--results <name>] [--no-jail]");
    process.exit(1);
  }
  const work = resolve(positionals[0]);
  const usesJail = !values["no-jail"] && process.platform === "linux";
  const runner = new Runner(work, resolve(values.bun), values.tsc && resolve(values.tsc), usesJail, 900, Number(values["files-at-a-time"]));
  const steps = new Set(values.steps.split(","));
  const waiting = projects.filter(project => new RegExp(values.only).test(project.name));
  const results: Result[] = [];
  const worker = async () => {
    for (let project; (project = waiting.shift()); ) {
      const result: Result = { name: project.name };
      if (steps.has("fetch")) result.installed = await runner.fetch(project);
      if (existsSync(runner.sourceOf(project)) && statSync(runner.sourceOf(project)).isDirectory()) {
        if (steps.has("types")) result.types = await runner.compareTypes(project);
        if (steps.has("build")) result.build = await runner.build(project);
        if (steps.has("tests")) result.tests = await runner.compareTests(project);
        if (steps.has("compiled")) result.compiled = await runner.compareCompiledTests(project);
      }
      results.push(result);
      console.log(rowOf(result));
      writeFileSync(join(work, values.results), JSON.stringify(results, null, 2));
    }
  };
  await Promise.all(Array.from({ length: Number(values.jobs) }, worker));
}
