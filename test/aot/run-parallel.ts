// Runs the programs under ./parallel: each must exit and print under `bun build --compile --aot` as it does under `bun <file>`.
//
//   bun test/aot/run-parallel.ts test/aot/parallel/classes/super-call.ts ..
//   bun test/aot/run-parallel.ts --jobs=4 --files-from=<a file with one path a line>      as scripts/runner.node.ts starts it
//   --no-erased       leaves out the second build, see below
//   --root=<folder>   the programs lie under that folder, not under ./parallel
//   --memory=<MB>     what all that runs at once may hold together. Without it: seven eighths of what the machine has available at the start
//
// A program with a TypeScript file is built twice, the second time with --aot-erase-types: types never change what a program prints.
// Not one that names much of Bun's library: nearly all of it is the library, which keeps its types.
//
// Many programs are the entry points of one executable. Each is compiled as it is when it is built alone, and each runs in a process
// of its own, which BUN_AOT_START_AT tells where to start.
// Those that name much of Bun's library are one program with many entry points, so the library is compiled once for all of them.
// Not one with a stored Output: what an executable leaves out goes by all that it holds.
//
// A program may begin with comment lines that say how it is built and run:
//   // Flags: --aot-validate           more flags for the build. A word that begins with ./ or ../ is a path from the folder of the program
//                                      With --aot-log-type-mismatches what the executable logs about the files of the program counts as printed: plain Bun logs nothing
//   // Entry points: ./child.cjs       further entry points, for what the program loads under a computed name. The program is built alone and starts
//   // Alone: <why>                    what it prints depends on what else the executable holds: it is built alone
//   // Env: TZ=America/New_York        the environment of both runs, one variable a line
//   // Env of the executable: A=b       the same, for the executable alone
//   // Reference: bun build --compile  it is compared with an executable built without --aot, with the flags that do not begin with --aot
//   // Exit code: 3                    what both runs end with. Without the line a reference that does not end with 0 fails the program: two runs that
//                                      stop at the same error agree and show nothing
//   // Todo: <why>                     it does not pass today. It is run all the same and reported as skipped, and fails once it passes: the line goes out.
//                                      `// Todo: Not every time: <why>`: it is skipped either way
//   // STATISTIC: <name> (= | >= | <=) <n>   what the build must have counted
// Those lines may also stand at the end, in front of the last comment: a stored output may name lines of the program, and a line more at the top moves them.
// It may end with a comment that says what is expected where that is not what plain Bun does:
//   /* Output: .. */                   what the executable prints. Behind a line `exit code <n>` stands the line that names the error
//   /* Build errors: .. */             the build ends with exit code 1 and these `error:` lines
//   // Erased types: as plain Bun      the build with --aot-erase-types is not held to Output
//   // Erased types: not built: <why>  there is no second build: without its types the program means something else
// A program that is built alone is built as anybody builds it: in its folder, with nothing but --compile --aot, a number of threads and its flags.
//
// Prints a line of JSON when it takes a file ({ file, state: "compiling" }) and one when the file is through
// ({ file, state: "pass", compileMs, runMs, plainMs, buildMB, runMB }, { file, state: "fail", stage, message, expected, actual } or { file, state: "skip", message }).
// One such line a file, when every way to build it is through. `ways` says how each went.
//
// Every build and every run has a time limit. What passes it is ended with everything it started, and the program fails alone.
// All that runs at once shares the memory that the machine has: where that runs short, what holds most is ended, and its program fails alone.
// However the driver ends, nothing that it started runs on and its temporary folder is gone.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { availableMemory, endAtMemoryLimitTogether } from "./harness/memory-limit";
import "./harness/without-installing-packages";

/** `overLimit`: why the driver ended it. */
type Output = { exitCode: number | null; signal: string | null; stdout: string; stderr: string; overLimit?: string };
type Bound = { name: string; relation: string; bound: number };
type Program = {
  file: string;
  path: string;
  flags: string[];
  env: Record<string, string>;
  envOfExecutable: Record<string, string>;
  entryPoints: string[];
  comparesWithCompiled: boolean;
  erasedIsAsPlain: boolean;
  isBuiltErased: boolean;
  isAlone: boolean;
  weight: number;
  exitCode: number;
  todo?: string;
  statistics: Bound[];
  output?: string;
  buildErrors?: string;
  way: "compiled" | "erased";
};

const programsInOneExecutable = 64;
// Whoever names one of these brings thousands of functions of Bun's library, and takes as long to build as eight other programs.
const namesMuchOfTheLibrary =
  /["'`](?:node:)?(?:assert|child_process|cluster|console|crypto|dgram|diagnostics_channel|dns|events|fs|https?|http2|inspector|net|perf_hooks|readline|repl|stream|tls|tty|util|v8|worker_threads|zlib)(?:\/[a-z]+)?["'`]|\bWorker\b|\bprocess\.std(?:in|out|err)\b/;
const sharesLibrary = ({ weight, output }: Program) => weight > 1 && output === undefined;
const weightOf = (programs: Program[]) =>
  programs.reduce(
    (sum, program) => sum + (sharesLibrary(program) ? 1 : program.weight),
    sharesLibrary(programs[0]) ? 8 : 0,
  );
const longestCommandLine = 30_000;
const longestTextShown = 16 * 1024;

const option = (name: string) =>
  process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(option("root") ?? join(import.meta.dir, "parallel"));
const listed = option("files-from");
const files = listed
  ? readFileSync(listed, "utf8").split(/\r?\n/).filter(Boolean)
  : process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const jobs = Number(option("jobs")) || availableParallelism();
const erases = !process.argv.includes("--no-erased");
// A driver that is killed outright leaves its folder. Every build writes into the folder, and none takes hours.
for (const name of readdirSync(tmpdir())) {
  if (!name.startsWith("aot-parallel-")) continue;
  const left = join(tmpdir(), name);
  if (Date.now() - (statSync(left, { throwIfNoEntry: false })?.mtimeMs ?? Infinity) > 2 * 60 * 60_000)
    rmSync(left, { recursive: true, force: true });
}
const folder = mkdtempSync(join(tmpdir(), "aot-parallel-"));
let saidAt = 0;
let lastTaken: object | undefined;
const say = (line: object) => {
  saidAt = performance.now();
  console.log(JSON.stringify(line));
};
// What a stored output and the search for `error` lines rely on. Both runs get the same environment: a program may print it.
const { FORCE_COLOR: _, ...inherited } = process.env;
const environment = {
  ...inherited,
  NO_COLOR: "1",
  TZ: "Etc/UTC",
  BUN_AOT_VERBOSE: "1",
  // Plain Bun transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
  BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1",
  // A Bun ends with the process that started it, and takes along what it started itself.
  BUN_FEATURE_FLAG_NO_ORPHANS: "1",
};
let hasFailed = false;

let free = jobs;
const waiting: (() => void)[] = [];
async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (free > 0) free--;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    await untilThereIsRoom();
    return await work();
  } finally {
    giveBack(1);
  }
}
function giveBack(slots: number) {
  for (; slots > 0; slots--) {
    const next = waiting.shift();
    if (next) next();
    else free++;
  }
}
const memory = endAtMemoryLimitTogether(
  Number(option("memory")) * 2 ** 20 || (availableMemory() * 7) / 8,
  "the fattest",
);
async function untilThereIsRoom() {
  while (!memory.hasRoom()) await Bun.sleep(50);
}
let buildsToStart = 0;
/** A build has a thread for each slot that it holds: one while other builds wait, and its share of the free ones when few are left. */
async function withSlotsOfBuild<T>(work: (threads: number) => Promise<T>): Promise<T> {
  buildsToStart++;
  // The builds that are asked for in one turn all count.
  await Promise.resolve();
  if (free > 0) free--;
  else await new Promise<void>(resolve => waiting.push(resolve));
  const more = Math.floor(free / buildsToStart--);
  free -= more;
  try {
    await untilThereIsRoom();
    return await work(1 + more);
  } finally {
    giveBack(1 + more);
  }
}

const isWindows = process.platform === "win32";
const isASAN = (() => {
  try {
    return require("bun:internal-for-testing").isASANEnabled() as boolean;
  } catch {
    return basename(process.execPath).includes("asan");
  }
})();
/** In seconds, for a run or the build of one program, and for each further program of a build. A build that is ended for nothing is made twice, so the limit is several times what a busy machine takes. */
const timeLimit = (cmd: string[], programs = 1) =>
  (isASAN || cmd.some(flag => /^--aot-(validate$|verify-each-pass$|check=.*\bverify-each-pass\b)/.test(flag))
    ? 240
    : 90) +
  (isASAN ? 30 : 15) * (programs - 1);
const secondsToAnswer = 3;

/** Each child leads a process group of its own, which holds whatever it starts. */
const running = new Set<number>();
function endGroup(pid: number, signal: "SIGTERM" | "SIGKILL") {
  try {
    if (!isWindows) process.kill(-pid, signal);
    else if (signal === "SIGKILL")
      Bun.spawnSync(["taskkill", "/pid", String(pid), "/t", "/f"], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {}
}
process.on("exit", () => {
  for (const pid of running) endGroup(pid, "SIGKILL");
  // On Windows the file of an executable stays in use for a moment behind its end.
  try {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
});
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(2));
// Whoever reads these lines ends a driver that says nothing for minutes. A build of many programs may take that long.
setInterval(() => {
  if (lastTaken && running.size && performance.now() - saidAt > 60_000) say(lastTaken);
}, 10_000).unref();

async function start(cmd: string[], cwd: string, env: Record<string, string | undefined>, seconds = timeLimit(cmd)) {
  const began = performance.now();
  const child = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: !isWindows });
  const { pid } = child;
  running.add(pid);
  // A build that is asked to end says what each of its threads is still compiling.
  const answers = cmd[1] === "build" && !isWindows;
  using held = memory.watch({ pid, kill: signal => endGroup(pid, signal) }, cmd[1] !== "build");
  let ranOver = false;
  const end = (signal: "SIGTERM" | "SIGKILL") => {
    ranOver = true;
    endGroup(pid, signal);
  };
  const timers = [
    setTimeout(end, seconds * 1000, "SIGKILL"),
    ...(answers ? [setTimeout(end, (seconds - secondsToAnswer) * 1000, "SIGTERM")] : []),
  ];
  try {
    // What the child started may hold its pipes open when the child itself is gone: the limits hold until they close.
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    const output: Output = {
      exitCode: child.signalCode ? null : exitCode,
      signal: child.signalCode,
      stdout,
      stderr,
      overLimit: held.exceeded ? held.held : ranOver ? `it ran over ${seconds} s` : undefined,
    };
    return { output, ms: Math.round(performance.now() - began), peakMB: Math.round(held.peak / 2 ** 20) };
  } finally {
    timers.forEach(clearTimeout);
    if (!isWindows) endGroup(pid, "SIGKILL");
    running.delete(pid);
  }
}
const describeEnd = ({ exitCode, signal, overLimit }: Output) =>
  `${signal ?? `exit code ${exitCode}`}${overLimit ? `: ${overLimit}` : ""}`;

/** What the two runs must agree on. Below an uncaught error stand frames with paths, which differ between an executable and its sources. */
const compared = ({ exitCode, signal, stdout, stderr }: Output) => ({
  exitCode,
  signal,
  // A duration that a program measures is not part of its behavior.
  stdout: stdout.replace(/ [0-9]+ms$/gm, ""),
  stderr:
    exitCode === 0
      ? stderr
          .replace(/^\(node:[0-9]+\) /gm, "(node) ")
          .replace(/^\(Use `[^`\n]* --trace-warnings /gm, "(Use `bun --trace-warnings ")
      : (stderr.split("\n").find(line => /^(error|[A-Za-z]*Error)\b/.test(line)) ?? ""),
});
const shown = (output: Output) => ({
  ...output,
  stdout: output.stdout.slice(0, longestTextShown),
  stderr: output.stderr.slice(0, longestTextShown),
});

const waysLeft = new Map<string, number>();
const verdicts = new Map<string, Record<string, unknown>[]>();
/** A file has one verdict: the first way that fails, or else the first. */
function settle(program: Program, verdict: Record<string, unknown>) {
  const all = [...(verdicts.get(program.file) ?? []), { file: program.file, way: program.way, ...verdict }];
  verdicts.set(program.file, all);
  if (all.length < waysLeft.get(program.file)!) return;
  const sum = (name: string) => all.reduce((total, verdict) => total + Number(verdict[name] ?? 0), 0);
  const failed = all.some(({ state }) => state === "fail");
  if (program.todo !== undefined) {
    if (failed || program.todo.startsWith("Not every time:"))
      return say({ file: program.file, state: "skip", message: `todo: ${program.todo}` });
    hasFailed = true;
    return say({
      file: program.file,
      state: "fail",
      stage: "todo",
      message: "it passes: its `// Todo:` line goes out",
    });
  }
  hasFailed ||= failed;
  say({
    ...(all.find(({ state }) => state === "fail") ?? {
      ...all[0],
      compileMs: sum("compileMs"),
      runMs: sum("runMs"),
      plainMs: sum("plainMs"),
    }),
    ways: Object.fromEntries(all.map(({ way, state }) => [way, state])),
  });
}
function fail(program: Program, stage: string, message: string, actual?: Output, expected?: Output) {
  settle(program, {
    state: "fail",
    stage,
    message: program.way === "erased" ? `with --aot-erase-types: ${message}` : message,
    expected: expected && shown(expected),
    actual: actual && shown(actual),
  });
}

function read(file: string): Program {
  const path = resolve(file);
  const text = readFileSync(path, "utf8");
  const head =
    /^(?:#!.*\r?\n)?(?:\/\/.*\r?\n)*/.exec(text)![0] +
    (/\n((?:\/\/.*\r?\n)+)\/\* (?:Output|Build errors):\r?\n(?:(?!\*\/)[^])*\*\/\s*$/.exec(text)?.[1] ?? "");
  const lines = (name: string) =>
    [...head.matchAll(new RegExp(`^// ${name}:[ \\t]+(.*)$`, "gm"))].map(([, value]) => value.trim());
  const words = (name: string) => lines(name).flatMap(value => value.split(/\s+/));
  const last = (name: string) =>
    new RegExp(`(?:^|\\n)/\\* ${name}:\\r?\\n((?:(?!\\*/)[^])*)\\*/\\s*$`)
      .exec(text)?.[1]
      .replaceAll("*\\/", "*/")
      .replaceAll("\r\n", "\n");
  return {
    file,
    path,
    flags: words("Flags"),
    env: Object.fromEntries(lines("Env").map(line => line.split(/=(.*)/s).slice(0, 2))),
    envOfExecutable: Object.fromEntries(lines("Env of the executable").map(line => line.split(/=(.*)/s).slice(0, 2))),
    entryPoints: words("Entry points"),
    comparesWithCompiled: lines("Reference").includes("bun build --compile"),
    erasedIsAsPlain: lines("Erased types").includes("as plain Bun"),
    isBuiltErased: !lines("Erased types").some(line => line.startsWith("not built")),
    isAlone: lines("Alone").length > 0,
    weight: namesMuchOfTheLibrary.test(text) ? 8 : 1,
    exitCode: Number(lines("Exit code")[0] ?? 0),
    todo: lines("Todo")[0],
    statistics: Array.from(text.matchAll(/^\/\/ STATISTIC: (\w+) (=|>=|<=) (\d+)$/gm), ([, name, relation, bound]) => ({
      name,
      relation,
      bound: Number(bound),
    })),
    output: last("Output"),
    buildErrors: last("Build errors"),
    way: "compiled",
  };
}

function nearestProject(path: string) {
  for (let at = dirname(path); at.startsWith(root + sep); at = dirname(at))
    if (existsSync(join(at, "tsconfig.json"))) return at;
  return root;
}

/** The programs that the errors of a build point into. */
function findRefused(stderr: string, programs: Program[]) {
  const refused = new Map<Program, string>();
  let error: string | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    if (/^error\b/.test(line)) error = line;
    const [, file] = /^\s+at (.+):\d+:\d+$/.exec(line) ?? [];
    if (!file || error === undefined) continue;
    const named = resolve(root, file);
    const program = programs.find(
      ({ path }) => path === named || (/[\\/]main\.[a-z]+$/.test(path) && named.startsWith(dirname(path) + sep)),
    );
    if (program && !refused.has(program)) refused.set(program, error);
    error = undefined;
  }
  return refused;
}

let executables = 0;
const nextExecutable = (name: string) =>
  join(folder, `${name}-${executables++}${process.platform === "win32" ? ".exe" : ""}`);

/** As it stands in the comment Output. What is stored names the files of an executable as they are named elsewhere than on Windows. */
const asText = ({ exitCode, stdout, stderr }: ReturnType<typeof compared>) =>
  (stdout + (exitCode ? `exit code ${exitCode}\n${stderr}\n` : stderr)).replace(
    /B:\\~BUN\\root[^\s'":]*/g,
    path => "/$bunfs/root" + path.slice(12).replaceAll("\\", "/"),
  );

function unmetBounds(buildOutput: string, bounds: Bound[]) {
  const counted = new Map(
    Array.from(buildOutput.matchAll(/^(\w+) (\d+)$/gm), ([, name, value]) => [name, Number(value)] as const),
  );
  return bounds
    .filter(({ name, relation, bound }) => {
      const value = counted.get(name);
      return (
        value === undefined ||
        !(relation === "=" ? value === bound : relation === ">=" ? value >= bound : value <= bound)
      );
    })
    .map(
      ({ name, relation, bound }) =>
        `${name} ${relation} ${bound}, but the build counted ${counted.get(name) ?? "no such statistic"}`,
    );
}

/** Both ways to build a file are held to one run of the reference. */
const references = new Map<string, ReturnType<typeof start>>();

async function run(programs: Program[]): Promise<void> {
  if (programs.length === 0) return;
  const inParts = (parts: number) => {
    const size = Math.ceil(programs.length / parts);
    return Promise.all(
      Array.from({ length: Math.ceil(programs.length / size) }, (_, index) =>
        run(programs.slice(index * size, (index + 1) * size)),
      ),
    );
  };
  const halves = () => inParts(2);
  const [first] = programs;
  const isAlone = isBuiltAlone(first);
  const buildsIn = isAlone ? dirname(first.path) : root;
  const entryPoints = programs.map(program => "./" + relative(buildsIn, program.path).replaceAll("\\", "/"));
  if (programs.length > 1 && entryPoints.join(" ").length > longestCommandLine) return void (await halves());
  const executable = nextExecutable("programs");
  const command = (threads: number) => [
    process.execPath,
    "build",
    "--compile",
    "--aot",
    ...(isAlone ? [] : [...(sharesLibrary(first) ? [] : ["--aot-separate-programs"]), `--root=${root}`]),
    `--aot-threads=${threads}`,
    ...first.flags,
    ...(first.way === "erased" ? ["--aot-erase-types"] : []),
    ...(first.statistics.length ? ["--explain=statistics"] : []),
    ...entryPoints,
    ...first.entryPoints,
    "--outfile",
    executable,
  ];
  const build = await withSlotsOfBuild(threads => {
    for (const { file, way } of programs) say((lastTaken = { file, way, state: "compiling" }));
    const cmd = command(threads);
    return start(cmd, buildsIn, environment, timeLimit(cmd, weightOf(programs)));
  });
  try {
    if (build.output.overLimit) {
      if (programs.length > 1) {
        console.error(`A build of ${programs.length} programs is made again in parts: ${build.output.overLimit}.`);
        return void (await inParts(8));
      }
      const still = build.output.stderr.split("\n").filter(line => line.startsWith("Still "));
      return fail(
        first,
        "compile",
        [`the build ended with ${describeEnd(build.output)}`, ...still].join("\n  "),
        build.output,
      );
    }
    if (first.buildErrors !== undefined) {
      // Each distinct error counts once. A Bun built with assertions names the token behind some of the messages of the parser.
      const lines = build.output.stderr.split(/\r?\n/).filter(line => line.startsWith("error: "));
      const errors = [...new Set(lines.map(line => line.replace(/ \(token: T\w+\)$/, "")))].join("\n") + "\n";
      if (errors === first.buildErrors && build.output.exitCode === 1)
        return settle(first, { state: "pass", compileMs: build.ms });
      return fail(
        first,
        "compile",
        "the build does not end with exit code 1 and the errors that the program lists",
        build.output,
      );
    }
    if (build.output.exitCode !== 0 || /^error\b/m.test(build.output.stderr)) {
      const refused = findRefused(build.output.stderr, programs);
      if (programs.length === 1)
        return fail(
          first,
          "compile",
          refused.get(first) ?? `the build ended with ${describeEnd(build.output)}`,
          build.output,
        );
      if (refused.size === 0 || refused.size === programs.length) return void (await halves());
      return void (await Promise.all([
        run(programs.filter(program => !refused.has(program))),
        ...[...refused.keys()].map(program => run([program])),
      ]));
    }
    const unmet = first.way === "compiled" ? unmetBounds(build.output.stderr, first.statistics) : [];
    if (unmet.length) return fail(first, "compile", unmet.join("; "), build.output);
    const compileMs = Math.round(build.ms / programs.length);
    await Promise.all(
      programs.map(async (program, index) => {
        const env = {
          ...environment,
          ...program.env,
          ...(!isAlone && { BUN_AOT_START_AT: entryPoints[index].slice(2) }),
        };
        const cwd = dirname(program.path);
        const stored = program.way === "erased" && program.erasedIsAsPlain ? undefined : program.output;
        const runReference = async () => {
          if (!program.comparesWithCompiled) return withSlot(() => start([process.execPath, program.path], cwd, env));
          const other = nextExecutable("reference");
          try {
            const flags = program.flags.filter(flag => !flag.startsWith("--aot"));
            const built = await withSlot(() =>
              start(
                [
                  process.execPath,
                  "build",
                  "--compile",
                  ...flags,
                  program.path,
                  ...program.entryPoints,
                  "--outfile",
                  other,
                ],
                cwd,
                environment,
              ),
            );
            if (built.output.exitCode !== 0) return built;
            return await withSlot(() => start([other], cwd, env));
          } finally {
            rmSync(other, { force: true });
          }
        };
        const reference = () => {
          if (stored !== undefined) return undefined;
          const known = references.get(program.path);
          if (known) return known.then(({ output, peakMB }) => ({ output, ms: 0, peakMB }));
          const first = runReference();
          references.set(program.path, first);
          return first;
        };
        // One behind the other: what holds much in one holds much in the other.
        const compiled = await withSlot(() => start([executable], cwd, { ...env, ...program.envOfExecutable }));
        if (compiled.output.overLimit)
          return fail(program, "run", `it ended by ${describeEnd(compiled.output)}`, compiled.output);
        const plain = await reference();
        if (compiled.output.signal)
          return fail(program, "run", `it ended by ${describeEnd(compiled.output)}`, compiled.output, plain?.output);
        // The executable ran compiled code and did not fall back to the source it holds.
        if (!compiled.output.stderr.includes("[aot] module: "))
          return fail(program, "run", "it did not run compiled code", compiled.output, plain?.output);
        compiled.output.stderr = compiled.output.stderr.replace(
          /^\[aot\] (?!type-mismatch \S+ \S+ (?!internal:|bun:|node:)).*\r?\n/gm,
          "",
        );
        const passes = {
          state: "pass",
          compileMs,
          runMs: compiled.ms,
          buildMB: build.peakMB,
          runMB: Math.max(compiled.peakMB, plain?.peakMB ?? 0),
        };
        if (stored !== undefined) {
          if (asText(compared(compiled.output)) === stored) return settle(program, passes);
          return fail(program, "compare", "it does not print what its last comment says", compiled.output, {
            exitCode: null,
            signal: null,
            stdout: stored,
            stderr: "",
          });
        }
        if (plain!.output.exitCode !== program.exitCode || plain!.output.overLimit)
          return fail(
            program,
            "reference",
            `the reference ended with ${describeEnd(plain!.output)}, not with ${program.exitCode}: see \`// Exit code:\``,
            compiled.output,
            plain!.output,
          );
        if (Bun.deepEquals(compared(compiled.output), compared(plain!.output)))
          settle(program, { ...passes, plainMs: plain!.ms });
        else fail(program, "compare", "it does not exit and print as plain Bun does", compiled.output, plain!.output);
      }),
    );
  } finally {
    rmSync(executable, { force: true });
  }
}

const limited = { timeout: timeLimit([]) * 1000, killSignal: "SIGKILL" } as const;
const refusal = /^error: --aot ((?:only supports|isn't available) .*)$/m.exec(
  Bun.spawnSync([process.execPath, "build", "--compile", "--aot", "./no-such-file.ts"], {
    cwd: root,
    ...limited,
  }).stderr.toString(),
)?.[1];
const revision = Bun.spawnSync([process.execPath, "--revision"], limited);
const isCanary = !revision.success || revision.stdout.toString().includes("-canary");
const describe = (what: string, { exitCode, signalCode, stdout, stderr }: Bun.SyncSubprocess<"pipe", "pipe">) =>
  [
    `${what} ended with ${signalCode ?? `exit code ${exitCode}`} and printed ${JSON.stringify(stdout.toString().slice(0, 200))}`,
    ...stderr.toString().slice(0, longestTextShown).trimEnd().split("\n").filter(Boolean),
  ].join("\n  ");
/** Two programs of one line in one executable: the second starts when it is named. Answers what happens in place of that. */
function findWhyNothingStartsWhereItIsTold() {
  for (const name of ["first", "second"]) writeFileSync(join(folder, `${name}.js`), `console.log("${name}");\n`);
  const probe = join(folder, `probe${process.platform === "win32" ? ".exe" : ""}`);
  if (!revision.success) return describe("bun --revision", revision);
  const build = Bun.spawnSync(
    [
      process.execPath,
      "build",
      "--compile",
      "--aot",
      "--aot-separate-programs",
      `--root=${folder}`,
      "./first.js",
      "./second.js",
      "--outfile",
      probe,
    ],
    { cwd: folder, ...limited },
  );
  if (!build.success || !existsSync(probe)) return describe("the build of two programs of one line", build);
  const run = Bun.spawnSync([probe], { env: { ...process.env, BUN_AOT_START_AT: "second.js" }, ...limited });
  for (const path of [join(folder, "first.js"), join(folder, "second.js"), probe]) rmSync(path, { force: true });
  if (run.success && run.stdout.toString().trim() === "second") return undefined;
  return describe("an executable of two programs of one line that BUN_AOT_START_AT tells to start at the second", run);
}
const whySkipped = refusal
  ? `--aot ${refusal}`
  : isCanary
    ? undefined
    : "only a canary build of Bun reads BUN_AOT_START_AT";
if (whySkipped) {
  for (const file of files) say({ file, state: "skip", message: whySkipped });
  console.error(`SKIPPED all ${files.length} programs: ${whySkipped}`);
  process.exit(0);
}
// A Bun that cannot do this much passes nothing: no program is left out for it.
const whyNothingStarts = findWhyNothingStartsWhereItIsTold();
if (whyNothingStarts) {
  for (const file of files) say({ file, state: "fail", stage: "probe", message: whyNothingStarts });
  process.exit(1);
}

// What a Worker starts from is compiled with the program that starts it, so such a program has a build of its own.
const startsWorkers = (program: Program) =>
  /\bWorker\b|worker_threads|\bcluster\b/.test(readFileSync(program.path, "utf8"));
// What a program declares into a module or into the global scope, every other program of the executable would be checked against.
const declaresForOthers = ({ path }: Program) =>
  (/[\\/]main\.[a-z]+$/.test(path)
    ? readdirSync(dirname(path), { recursive: true, encoding: "utf8" })
        .filter(name => /\.[cm]?tsx?$/.test(name) && !name.includes("node_modules"))
        .map(name => join(dirname(path), name))
        .filter(file => statSync(file).isFile())
    : [path]
  ).some(file => /^\s*declare\s+(global\b|module\s*["'])/m.test(readFileSync(file, "utf8")));
// A flag of the bundler changes what the files of a build are and where they are looked for, and a flag that is a path is read in the folder of the program.
const isBuiltAlone = (program: Program) =>
  program.isAlone ||
  program.comparesWithCompiled ||
  program.entryPoints.length > 0 ||
  program.statistics.length > 0 ||
  program.buildErrors !== undefined ||
  program.flags.some(flag => !flag.startsWith("--aot")) ||
  startsWorkers(program) ||
  declaresForOthers(program);
const isTypeScript = (name: string) => /\.(ts|tsx|mts|cts)$/.test(name) && !/\.d\.[mc]?ts$/.test(name);
const hasTypes = ({ path }: Program) =>
  /[\\/]main\.[a-z]+$/.test(path)
    ? readdirSync(dirname(path), { recursive: true, encoding: "utf8" }).some(isTypeScript)
    : isTypeScript(path);
const asWritten = files.map(read);
const all = [
  ...asWritten,
  ...(erases
    ? asWritten
        .filter(
          program =>
            program.isBuiltErased && program.weight === 1 && program.buildErrors === undefined && hasTypes(program),
        )
        .map(program => ({ ...program, way: "erased" as const }))
    : []),
];
for (const { file } of all) waysLeft.set(file, (waysLeft.get(file) ?? 0) + 1);
// Two entry points that differ in the extension alone have one name in an executable.
const withoutExtension = (path: string) => path.replace(/\.[a-z]+$/, "");
const twins = Map.groupBy(asWritten, program => withoutExtension(program.path));
const groups = Map.groupBy(all, program =>
  JSON.stringify([
    program.way,
    program.flags,
    nearestProject(program.path),
    isBuiltAlone(program) && program.path,
    sharesLibrary(program),
    twins.get(withoutExtension(program.path))!.findIndex(({ path }) => path === program.path),
  ]),
);
const batches = [...groups.values()].flatMap(group => {
  const most = Math.ceil(weightOf(group) / Math.ceil(weightOf(group) / programsInOneExecutable));
  const batches: Program[][] = [[]];
  for (const program of group) {
    if (batches.at(-1)!.length && weightOf([...batches.at(-1)!, program]) > most) batches.push([]);
    batches.at(-1)!.push(program);
  }
  return batches;
});
await Promise.all(batches.map(run));
process.exit(hasFailed ? 1 : 0);
