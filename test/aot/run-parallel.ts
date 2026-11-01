// Runs the programs under ./parallel: each must exit and print under `bun build --compile --aot` as it does under `bun <file>`.
//
//   bun test/aot/run-parallel.ts test/aot/parallel/classes/super-call.ts ..
//   bun test/aot/run-parallel.ts --jobs=4 --files-from=<a file with one path a line>      as scripts/runner.node.ts starts it
//   --no-erased       leaves out every build but the first, see below
//   --no-alone        leaves out the builds of each program alone
//   --alone-under="--aot-validate"   of the builds of each program alone only one, with these flags, for every program
//   --each-alone      every program is built by itself: what an executable leaves out goes by all it holds, so beside others a program keeps what it would lose alone
//   --root=<folder>   the programs lie under that folder, not under ./parallel
//   --memory=<MB>     what all that runs at once may hold together. Without it: seven eighths of what the machine has available at the start
//   --seconds=<n>     the time limit of a run. Default: 90, or 240 under ASAN
//   --more-flags="--aot-validate --aot-check=moved-loads"   every build takes these flags too: the programs under the compiler's own checks. A check counts, prints and
//                     keeps more than a build without it: what a program says that a build or a run counts or prints is not asked, and no `// Todo:` is held to fail
//   --checks-at-run-time   an executable that has passed runs once more with the checks of the run time on (BUN_JSC_validateAOTRuntime): they end it with a line
//                     "AOT validation: .." where something that the compiler relies on does not hold, also where the answer is right. That line fails the program,
//                     and so does a second run that does not exit and print as the first. AOT_CHECKS_AT_RUN_TIME=1 in the environment says the same, for whoever does not start this file himself
//   --deal            builds and runs nothing: prints the first builds of the programs, a line each: { ms, files }. scripts/runner.node.ts deals whole builds to the shards
//
// For every build CI takes, of the programs of --files-from, those that ./parallel/every-build.txt names, each in its first build alone. The others count as skipped.
// harness/every-build.ts says who takes all of them. A program that is named on the command line is run.
//
// A program with a TypeScript file is built twice, the second time with --aot-erase-types: types never change what a program prints.
// Not one that names much of Bun's library: nearly all of it is the library, which keeps its types.
//
// Then every program is built alone, as whoever has written it builds it, and held against plain Bun again: of twelve programs that were once compiled wrongly
// all twelve showed it alone, and four beside thirty others. And alone under --aot-validate: a validating build is another build, and one has answered wrongly,
// with exit code 0 and no line of the validator, where the product was right. Alone under each of the compiler's other checks (`buildsAlone` below) a run takes
// a tenth of the programs, by the name of the program and the number of the day, which it prints: AOT_DAY=<n> takes the same tenth.
// As under --more-flags, a build with a check is not asked what the program says that a build or a run counts or prints.
//
// Many programs are the entry points of one executable. Each is compiled as it is when it is built alone, and each runs in a process
// of its own, which BUN_AOT_START_AT tells where to start.
// Those that name much of Bun's library are one program with many entry points, so the library is compiled once for all of them.
// So are the programs of the second build: the first has asked each as it is alone.
// What the compiler leaves out of an executable goes by how much it knows, and it knows less beside others: a program that is refused something
// there, and not by plain Bun, is built again alone and judged by that.
// Not one with a stored Output: what an executable leaves out goes by all that it holds. Those that write to a built-in object and name no
// module of the library share only among themselves, and only if they bring much of the library: what the others may rely on goes by what is written.
//
// A program may begin with comment lines that say how it is built and run:
//   // Flags: --aot-validate           more flags for the build. A word that begins with ./ or ../ is a path from the folder of the program
//                                      With --aot-log-type-mismatches what the executable logs about the files of the program counts as printed: plain Bun logs nothing
//   // Entry points: ./child.cjs       further entry points, for what the program loads under a computed name. The program is built alone and starts
//   // Alone: <why>                    what it prints depends on what else the executable holds: it is built alone
//   // Runs by itself: <why>           it keeps more threads busy than a machine has processors: it is built alone, and its runs come last, each with nothing beside it
//   // Env: TZ=America/New_York        the environment of both runs, one variable a line
//   // Env of the executable: A=b       the same, for the executable alone
//   // Env of the build: A=b            the same, for the build alone
//   // Build prints: 2 x <line>         how often the build prints exactly that line
//   // Reference: bun build --compile  it is compared with an executable built without --aot, with the flags that do not begin with --aot
//   // Exit code: 3                    what both runs end with. Without the line a reference that does not end with 0 fails the program: two runs that
//                                      stop at the same error agree and show nothing
//   // Todo: <why>                     it does not pass today. It is run all the same and reported as skipped, and fails once it passes: the line goes out.
//                                      `// Todo: Not every time: <why>`: it is skipped either way
//   // Todo on win32 x64: <why>        the same where process.platform and process.arch are those two, and nothing anywhere else. There it goes before a `// Todo:`
//   // Todo under ASAN: <why>          the same where Bun is built with the address sanitizer, and nothing anywhere else. There it goes before the other two
//   // Todo alone: <why>               none of its builds alone passes today. The others are held as ever. It fails once one of them passes: the line goes out
//   // Todo alone under --aot-validate: <why>   the same for the one build alone with those flags. `Not every time: <why>`: it is held to nothing
//   // Todo alone under a check: <why>  the same for every build alone that has flags
//   // Never alone: <why>              what it prints hangs on the folders above it, which an executable built in its own folder does not have: none of the builds alone
//   // Prints what the compiler saves: <what>   its output counts cells, promises or the like. Under --more-flags it is built and run, and what it prints is not compared
//   // STATISTIC: <name> (= | >= | <=) <n>   what the build must have counted
//                                      ImageFunctionsAndJumpsInTheirPlace: ImageFunctionsEmitted and JumpOnlyFunctionsRemoved added up. A Bun with assertions generates checks
//                                      into a function that is one jump in a release, so it emits hundreds that a release removes: the sum hardly differs
//   // COUNT: <name> (= | >= | <=) <n>       what the executable must have counted when it ends: no clock, and the same on every machine.
//                                      A name as BUN_JSC_aotCountsPath writes it (operation:operationAOTGetById, counter:CompiledStructuresMade), or all of a kind:
//                                      operations (calls into the run time), arrivals (accesses that look a name up), branches (two-way branches of compiled code
//                                      that ran), arrivalsAndBranches (the two added up: a lookup that became a test counts the same), cells and bytes (what compiled code and its stubs allocate), allCells (with what the run time allocates). The run has no collection. What the program starts counts too
//   // COUNTER: <name> (= | >= | <=) <n>     the same, with the name as shell/expectations.py reads it, which asks the `jsc` shell: without its kind
//                                      (CompiledStructuresMade, LookupTableBases, operationAOTGetById)
//                                      Each of the three may end with ` Todo: <why>`: it is not met today. It is asked all the same, and fails once it is met: the words go out.
//                                      The rest of the program is held as ever. A name that nothing counts fails with or without them.
//                                      A line that begins like one of the three and is not of that form fails the program: nothing that looks like a bound is passed over.
//                                      In a folder with a main file they may stand in any file: none of the others is a program
// A program may also ask while it runs: `typeof aotOperationCount === "function"`, and so for aotRuntimeCounters and aotBuiltinEntries. Only the `jsc` shell has these functions.
// In an executable there is none, the program counts nothing and says what it says for 0. So a program that names one and has passed also runs in the shell, as
// shell/quick.py runs it, and must print there what plain Bun prints: stage `count`. The shell and `testaot` are looked for as shell/tools.ts says. Where one of them is
// missing the line of the program says so (`countsNotAsked`), and so does a line on stderr at the end: it has not passed whatever it counts, it was not asked.
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
// `shellMs`: what its run in the shell took.
// One such line a file, when every way to build it is through. `ways` says how each went.
//
// Every build and every run has a time limit. What passes it is ended with everything it started, and the program fails alone.
// What a signal ends is judged at once, by that signal: nothing writes a core dump, and nothing that it leaves behind is waited for.
// All that runs at once shares the memory that the machine has: where that runs short, what holds most is ended, and its program fails alone.
// An executable is as large as Bun. What is built is run before more is built, and an executable goes when the last program that starts from it is judged.
// However the driver ends, nothing that it started runs on and its temporary folder is gone.
// Its last line, on stderr, says where the time went.
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { runsTheListAlone } from "./harness/every-build";
import { availableMemory, endAtMemoryLimitTogether } from "./harness/memory-limit";
import { withoutCoreDump } from "./harness/without-core-dump";
import "./harness/without-installing-packages";
import { canWriteProgram, findTool, whyNoScriptStarts } from "./shell/find-tools";

/** `overLimit`: why the driver ended it. */
type Output = { exitCode: number | null; signal: string | null; stdout: string; stderr: string; overLimit?: string };
type Bound = { kind: string; name: string; relation: string; bound: number; todo?: string };
type Program = {
  file: string;
  path: string;
  flags: string[];
  env: Record<string, string>;
  envOfExecutable: Record<string, string>;
  envOfBuild: Record<string, string>;
  buildPrints: { times: number; line: string }[];
  entryPoints: string[];
  comparesWithCompiled: boolean;
  erasedIsAsPlain: boolean;
  isBuiltErased: boolean;
  isAlone: boolean;
  printsWhatIsSaved: boolean;
  isNeverAlone: boolean;
  runsByItself: boolean;
  weight: number;
  namesModules: boolean;
  writesToBuiltIn: boolean;
  exitCode: number;
  todo?: string;
  todoOfWays: (way: string) => string | undefined;
  statistics: Bound[];
  counts: Bound[];
  boundsNotRead: string[];
  asksTheShell: boolean;
  output?: string;
  buildErrors?: string;
  way: "compiled" | "erased" | `alone${string}`;
  /** Of a build alone: whether it has a check of the compiler in it, and why it does not pass today. */
  hasCheck?: boolean;
  todoOfWay?: string;
};

// A weight of one is what a small program takes of a build that it shares.
const msOfWeight = 300;
const programsInOneExecutable = 64;
// The library is compiled once for each such program, so the fewer the better. One build runs on one thread while others wait: it must not be the last to end.
const entryPointsOfOneProgram = 96;
const weightOfLibrary = 40;
// Whoever names one of these, in whichever of its files, brings thousands of functions of Bun's library, and takes as long to build as eight other programs.
const namesMuchOfTheLibrary =
  /["'`](?:node:)?(?:assert|child_process|cluster|console|crypto|dgram|diagnostics_channel|dns|events|fs|https?|http2|inspector|net|perf_hooks|readline|repl|stream|tls|tty|util|v8|worker_threads|zlib)(?:\/[a-z]+)?["'`]|\bWorker\b|\bprocess\.std(?:in|out|err)\b/;
const builtIn =
  "(?:globalThis|Object|Function|Array|String|Number|Boolean|Symbol|BigInt|Math|JSON|Reflect|Atomics|Intl|Temporal|Promise|Proxy|Map|Set|WeakMap|WeakSet|WeakRef|Date|RegExp|\\w*Error|Iterator|ArrayBuffer|SharedArrayBuffer|DataView|\\w+Array|WebAssembly|process|Bun|console|Buffer|URL|Response|Request|Headers|Blob)";
const writesToBuiltIn = new RegExp(
  [
    `\\b${builtIn}(?:\\.\\w+|\\[[^\\]\\n]+\\])+\\s*(?:=(?![=>])|\\+\\+|--|[-+*/|&^]=)`,
    `\\b(?:Object\\.(?:definePropert(?:y|ies)|assign|setPrototypeOf)|Reflect\\.(?:set|defineProperty|setPrototypeOf|deleteProperty))\\(\\s*${builtIn}\\b`,
    `\\bdelete\\s+${builtIn}\\b`,
  ].join("|"),
);
// So does whoever lets one of these stand as a value: all that hangs on it is out of the compiler's sight.
const handsOutObjectOfHost = /(?<![.\w$"'`:])(?:globalThis|process|Bun)\b(?!\s*\??\.\s*[A-Za-z_$])(?!["'`:])/;
// And whoever was seen to take long, which no text tells: the table by which the shards are dealt lists only such programs.
const tests = resolve(import.meta.dir, "..");
const tookMs = new Map(
  Object.entries<{ default?: number }>(JSON.parse(readFileSync(join(tests, "expected-durations.json"), "utf8")))
    .filter(([path]) => path.startsWith("aot/"))
    .map(([path, lanes]) => [join(tests, path), lanes.default ?? 0]),
);
/** Asks the file and the files that it names by relative paths, and those that they name. */
function someFileOf(path: string, holds: (text: string) => boolean) {
  const paths = [path];
  for (const path of paths) {
    const text = readFileSync(path, "utf8");
    if (holds(text)) return true;
    for (const [, name] of text.matchAll(/(?:\bfrom|\bimport|\bimport\(|\brequire\()\s*["'](\.\.?\/[^"'\n]+)["']/g)) {
      const named = resolve(dirname(path), name);
      const found = ["", ".ts", ".js", ".mjs", ".cjs", ".tsx", ".mts", ".cts"]
        .map(extension => named + extension)
        .find(candidate => statSync(candidate, { throwIfNoEntry: false })?.isFile());
      if (found && /\.[cm]?[jt]sx?$/.test(found) && !paths.includes(found)) paths.push(found);
    }
  }
  return false;
}
const saysWhatWasLeftOut = /was not compiled into this executable|the compiler couldn't tell at build time/;
const sharesLibrary = ({ weight, output, way, writesToBuiltIn }: Program) =>
  output === undefined && (weight > 1 || (!writesToBuiltIn && way === "erased"));
const weightOf = (programs: Program[]) => {
  const ofEachAlone = programs.reduce((sum, { weight }) => sum + weight, 0);
  return sharesLibrary(programs[0]) ? Math.min(ofEachAlone, weightOfLibrary + programs.length) : ofEachAlone;
};
// What a program took in CI, in milliseconds: its own build or its share of one, and its runs. One that takes under a second has no entry.
const tookInCI: Record<string, { default?: number } | undefined> = (() => {
  try {
    return JSON.parse(readFileSync(join(import.meta.dir, "..", "expected-durations.json"), "utf8"));
  } catch {
    return {};
  }
})();
/** In milliseconds. */
const expectedTimeOf = (programs: Program[]) =>
  programs.reduce(
    (sum, program) =>
      sum +
      (tookInCI[relative(join(import.meta.dir, ".."), program.path).replaceAll("\\", "/")]?.default ??
        800 * (sharesLibrary(program) ? 1 : program.weight)),
    0,
  );
// As shell/quick.py has it. Under Bun fixtures/jsc-shell-functions.ts answers memoryUsageStatistics.
const namesFunctionThatCounts = /\b(?:aotOperationCount|aotRuntimeCounters|aotBuiltinEntries)\b/;
const quick = join(import.meta.dir, "shell", "quick.py");
const longestCommandLine = 30_000;
const longestTextShown = 16 * 1024;

const option = (name: string) =>
  process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(option("root") ?? join(import.meta.dir, "parallel"));
const listed = option("files-from");
const given = listed
  ? readFileSync(listed, "utf8").split(/\r?\n/).filter(Boolean)
  : process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const takesTheListAlone = runsTheListAlone && !!listed && !option("root");
/** A program, or with `/` at its end a folder of them: below ./parallel. */
const inEveryBuild = takesTheListAlone
  ? readFileSync(join(root, "every-build.txt"), "utf8")
      .split(/\r?\n/)
      .filter(line => line && !line.startsWith("#"))
  : [];
const programsInEveryBuild = new Set(inEveryBuild);
const foldersInEveryBuild = inEveryBuild.filter(line => line.endsWith("/"));
const isInEveryBuild = (file: string) => {
  const path = relative(root, resolve(file)).replaceAll("\\", "/");
  return programsInEveryBuild.has(path) || foldersInEveryBuild.some(folder => path.startsWith(folder));
};
const files = takesTheListAlone ? given.filter(isInEveryBuild) : given;
const jobs = Number(option("jobs")) || availableParallelism();
const erases = !takesTheListAlone && !process.argv.includes("--no-erased");
const eachAlone = process.argv.includes("--each-alone");
const checksAtRunTime = process.argv.includes("--checks-at-run-time") || process.env.AOT_CHECKS_AT_RUN_TIME === "1";
const moreFlags = option("more-flags")?.split(/\s+/).filter(Boolean) ?? [];
const isASAN = (() => {
  try {
    return require("bun:internal-for-testing").isASANEnabled() as boolean;
  } catch {
    return basename(process.execPath).includes("asan");
  }
})();
/** `cost`: against a build alone without a check. */
const buildsAlone =
  !erases || moreFlags.length || process.argv.includes("--no-alone")
    ? []
    : option("alone-under") !== undefined
      ? [{ flags: option("alone-under")!.split(/\s+/).filter(Boolean), oneIn: 1, cost: 1 }]
      : [
          { flags: [], oneIn: 1, cost: 1 },
          { flags: ["--aot-validate"], oneIn: 1, cost: 2.2 },
          { flags: ["--aot-check=verify-each-pass"], oneIn: 10, cost: 5.3 },
          { flags: ["--aot-testing=CheckProofsAtRunTime"], oneIn: 10, cost: 1.2 },
          { flags: ["--aot-testing=CheckProofsAtRunTime", "--aot-check=ClaimsOfFlow"], oneIn: 10, cost: 1.3 },
          { flags: ["--aot-check=MovedLoads"], oneIn: 10, cost: 1.2 },
          // --aot-validate looks at B3 where its phases begin and end. This looks behind each of them. Under ASAN the largest programs would pass the time limit of a build.
          ...(isASAN ? [] : [{ flags: ["--aot-validate", "--aot-check=ValidateBackEnd"], oneIn: 10, cost: 2.1 }]),
        ];
const day = Number(process.env.AOT_DAY) || Math.floor(Date.now() / 86_400_000);
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
  // Plain Bun transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing, and goes by the variable
  // where a program can tell when a text comes: what a file that runs while a graph is loaded asks for with import().
  BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1",
  // A Bun ends with the process that started it, and takes along what it started itself.
  BUN_FEATURE_FLAG_NO_ORPHANS: "1",
  // A Bun that a signal ends starts a command that sends a report. It goes where scripts/runner.node.ts says, or nowhere.
  ...(!inherited.BUN_CRASH_REPORT_URL && { BUN_ENABLE_CRASH_REPORTING: "0" }),
  ...(isASAN && {
    // libpas serves WTF's fastMalloc unless Malloc is set, and AddressSanitizer does not intercept libpas: it would see no string, Vector or hash table.
    Malloc: "1",
    // The slow unwinder aborts in a frame of compiled code and cuts the report off.
    ASAN_OPTIONS:
      (inherited.ASAN_OPTIONS ?? "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=0") +
      ":fast_unwind_on_fatal=1",
  }),
};
// A build is a user's build. With this variable, which Bun's tests run under, the compiler checks its own work between the passes.
const { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: __, ...environmentOfBuilds } = environment;
let hasFailed = false;

let free = jobs;
const waiting: (() => void)[] = [];
const waitingBuilds: { weight: number; start: (slots: number) => void }[] = [];
/** The longest first, also where programs are built again: what is left for the end is short. */
function takeLongestBuild() {
  let longest = 0;
  for (let index = 1; index < waitingBuilds.length; index++)
    if (waitingBuilds[index].weight > waitingBuilds[longest].weight) longest = index;
  return waitingBuilds.splice(longest, 1)[0];
}
let expectedTimeOfAll = Infinity;
/** On one thread the longest build of a shard takes nearly as long as all the others together on the other slots. How many slots' worth of all the builds one is. */
const sharesOf = (expectedTime: number) => Math.max(1, Math.round(expectedTime / (expectedTimeOfAll / jobs)));
// Where the time went, in milliseconds. `inFlight`: summed over the slots that are taken.
const spent = { notedAt: 0, inFlight: 0, withFreeSlots: 0, beforeFirstSlot: 0, lastFullAt: 0, forMemory: 0 };
let waitForMemory = 0;
/** In front of every change of `free` and of `waitForMemory`. */
function noteTime() {
  const now = performance.now();
  const passed = now - spent.notedAt;
  spent.inFlight += (jobs - free - waitForMemory) * passed;
  if (free + waitForMemory > 0) spent.withFreeSlots += passed;
  else spent.lastFullAt = now;
  if (waitForMemory > 0) spent.forMemory += passed;
  if (!spent.beforeFirstSlot) spent.beforeFirstSlot = now;
  spent.notedAt = now;
}
function takeFreeSlots(count: number) {
  noteTime();
  free -= count;
}
async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (free > 0) takeFreeSlots(1);
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    await untilThereIsRoom();
    return await work();
  } finally {
    giveBack(1);
  }
}
const othersAreThrough = Promise.withResolvers<void>();
let lastByItself = othersAreThrough.promise;
/** Every slot, once all that shares the slots is through: nothing waits with slots in its hand. One at a time. */
function withEverySlot<T>(work: () => Promise<T>): Promise<T> {
  const result = lastByItself.then(async () => {
    const held = free;
    takeFreeSlots(held);
    // The build of another such program may still hold some.
    const rest = Array.from({ length: jobs - held }, () => new Promise<void>(resolve => waiting.push(resolve)));
    try {
      await Promise.all(rest);
      await untilThereIsRoom();
      return await work();
    } finally {
      giveBack(jobs);
    }
  });
  lastByItself = result.then(
    () => {},
    () => {},
  );
  return result;
}
function giveBack(slots: number) {
  while (slots > 0) {
    const next = waiting.shift();
    const build = next ? undefined : takeLongestBuild();
    // A build that is made again without the program that was refused takes the slots of the first.
    const given = build ? Math.min(slots, sharesOf(build.weight)) : 1;
    if (next) next();
    else if (build) build.start(given);
    else takeFreeSlots(-1);
    slots -= given;
  }
}
const memory = endAtMemoryLimitTogether(
  Number(option("memory")) * 2 ** 20 || (availableMemory() * 7) / 8,
  "the fattest",
);
const sizeOfBun = statSync(process.execPath).size;
const leftOnDisk = () => {
  const { bavail, bsize } = statfsSync(folder);
  return bavail * bsize;
};
// A build copies Bun and then writes the executable.
const hasRoomFor = (isBuild: boolean) =>
  memory.hasRoom() && (!isBuild || running.size === 0 || leftOnDisk() > 3 * sizeOfBun);
async function untilThereIsRoom(isBuild = false) {
  if (hasRoomFor(isBuild)) return;
  noteTime();
  waitForMemory++;
  while (!hasRoomFor(isBuild)) await Bun.sleep(50);
  noteTime();
  waitForMemory--;
}
const onDisk = { bytes: 0, executables: 0, mostBytes: 0, mostExecutables: 0 };
/** Answers what removes it. */
function noteExecutable(path: string) {
  let size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
  onDisk.bytes += size;
  onDisk.executables += size ? 1 : 0;
  onDisk.mostBytes = Math.max(onDisk.mostBytes, onDisk.bytes);
  onDisk.mostExecutables = Math.max(onDisk.mostExecutables, onDisk.executables);
  return () => {
    rmSync(path, { force: true });
    onDisk.bytes -= size;
    onDisk.executables -= size ? 1 : 0;
    size = 0;
  };
}
let buildsToStart = 0;
/** A build has a thread for each slot that it holds: as many as it has shares of all the builds while others wait, and its share of the free ones when few are left. */
async function withSlotsOfBuild<T>(weight: number, work: (threads: number) => Promise<T>): Promise<T> {
  buildsToStart++;
  // The builds that are asked for in one turn all count.
  await Promise.resolve();
  let held = 1;
  if (free > 0) takeFreeSlots(1);
  else held = await new Promise<number>(start => waitingBuilds.push({ weight, start }));
  const more = Math.max(Math.min(sharesOf(weight) - held, free), Math.floor(free / buildsToStart--));
  takeFreeSlots(more);
  held += more;
  try {
    await untilThereIsRoom(true);
    return await work(held);
  } finally {
    // Once whoever waits for the build has asked for the runs of what it made: they come first.
    setImmediate(giveBack, held);
  }
}

const isWindows = process.platform === "win32";
/** In seconds, for a run or the build of one program, and for each further program of a build. A build that is ended for nothing is made twice, so the limit is several times what a busy machine takes. */
const timeLimit = (cmd: string[], programs = 1) =>
  ((cmd[1] !== "build" && Number(option("seconds"))) ||
    (isASAN || cmd.some(flag => /^--aot-(validate$|verify-each-pass$|check=.*\bverify-each-pass\b)/.test(flag))
      ? 240
      : 90)) +
  (isASAN ? 30 : 15) * (programs - 1);
const secondsToAnswer = 3;

/** CPU time and the state and wait channel of each thread, from /proc. */
function describeThreads(pid: number) {
  if (process.platform !== "linux") return "";
  try {
    let seconds = 0;
    const states = new Map<string, number>();
    for (const thread of readdirSync(`/proc/${pid}/task`)) {
      const read = (file: string) => readFileSync(`/proc/${pid}/task/${thread}/${file}`, "utf8").trim();
      // The fields after the parenthesized name: state first, utime and stime (in 1/100 s) at 11 and 12.
      const stat = read("stat");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      seconds += (Number(fields[11]) + Number(fields[12])) / 100;
      const waitChannel = read("wchan");
      const state = `${fields[0]}${waitChannel && waitChannel !== "0" ? ` ${waitChannel}` : ""}`;
      states.set(state, (states.get(state) ?? 0) + 1);
    }
    const threads = [...states].sort((a, b) => b[1] - a[1]).map(([state, count]) => `${count} ${state}`);
    return ` (CPU time ${seconds.toFixed(1)} s; threads: ${threads.join(", ")})`;
  } catch {
    return "";
  }
}

/** Each child leads a process group of its own, which holds whatever it starts. */
const running = new Set<number>();
function endGroup(pid: number, signal: "SIGTERM" | "SIGKILL") {
  // The group of process 1 or 0 would be everybody, or this driver.
  if (!(pid > 1)) return;
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

const processes = Object.fromEntries(
  ["builds", "executables", "references", "runs in the shell"].map(kind => [
    kind,
    { count: 0, ms: 0, cpuMs: 0, longestMs: 0, longest: "" },
  ]),
);
let lastToEnd = "";
function noteProcess(cmd: string[], cwd: string, startsAt: string | undefined, ms: number, cpuMs: number) {
  const isBuild = cmd[1] === "build";
  const entryPoints = cmd.filter(word => /^\.\.?\//.test(word) || word.startsWith(root));
  const what = isBuild
    ? `${entryPoints.length} entry points from ${relative(root, resolve(cwd, entryPoints[0] ?? "."))}`
    : (startsAt ?? (cmd[1] === quick ? cmd[2] : relative(root, cmd[0] === process.execPath ? cmd[1] : cwd)));
  const kind =
    processes[
      isBuild
        ? "builds"
        : cmd[0] === process.execPath
          ? "references"
          : cmd[1] === quick
            ? "runs in the shell"
            : "executables"
    ];
  kind.count++;
  kind.ms += ms;
  kind.cpuMs += cpuMs;
  if (ms > kind.longestMs) [kind.longestMs, kind.longest] = [ms, what];
  lastToEnd = `${isBuild ? "the build of " : ""}${what}`;
}
function describeTime() {
  noteTime();
  const wall = performance.now();
  const inSeconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  return [
    `${basename(import.meta.path)}: ${inSeconds(wall)} for ${files.length} programs, ${(spent.inFlight / wall).toFixed(2)} of ${jobs} jobs in flight`,
    ...Object.entries(processes).map(
      ([name, { count, ms, cpuMs, longestMs, longest }]) =>
        `${count} ${name}: ${inSeconds(ms)}, ${inSeconds(cpuMs)} of CPU, the longest ${inSeconds(longestMs)}: ${longest}`,
    ),
    `${inSeconds(spent.withFreeSlots)} with fewer in flight: ${inSeconds(spent.beforeFirstSlot)} before the first build, ` +
      `${inSeconds(spent.forMemory)} waiting for memory or disk, ${inSeconds(wall - Math.max(spent.lastFullAt, spent.beforeFirstSlot))} at the end, behind ${lastToEnd}`,
    `${Math.round(onDisk.mostBytes / 2 ** 20)} MB in ${onDisk.mostExecutables} executables on disk at most`,
  ].join(" | ");
}

async function start(cmd: string[], cwd: string, env: Record<string, string | undefined>, seconds = timeLimit(cmd)) {
  const began = performance.now();
  const child = Bun.spawn({
    cmd: withoutCoreDump(cmd),
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: !isWindows,
  });
  const { pid } = child;
  running.add(pid);
  // A build that is asked to end says what each of its threads is still compiling.
  const answers = cmd[1] === "build" && !isWindows;
  using held = memory.watch({ pid, leadsAGroup: true }, cmd[1] !== "build", answers);
  let ranOver = false;
  let threadsAtLimit = "";
  const end = (signal: "SIGTERM" | "SIGKILL") => {
    if (!ranOver) threadsAtLimit = describeThreads(pid);
    ranOver = true;
    endGroup(pid, signal);
  };
  const timers = [
    setTimeout(end, seconds * 1000, "SIGKILL"),
    ...(answers ? [setTimeout(end, (seconds - secondsToAnswer) * 1000, "SIGTERM")] : []),
  ];
  // What a signal ended has printed all that it will. What it leaves behind, as the command that sends the report, has a second.
  if (!isWindows) child.exited.then(() => child.signalCode && timers.push(setTimeout(endGroup, 1000, pid, "SIGKILL")));
  try {
    // What the child started may hold its pipes open when the child itself is gone: the limits hold until they close.
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    const output: Output = {
      exitCode: child.signalCode ? null : exitCode,
      signal: child.signalCode,
      stdout,
      stderr,
      overLimit: held.exceeded
        ? held.held
        : ranOver
          ? `it ran over ${seconds} s${threadsAtLimit}`
          : exitCode !== 0 && stderr.includes("ENOSPC")
            ? `the disk is full: ${Math.round(leftOnDisk() / 2 ** 20)} MB are left for ${folder}`
            : undefined,
    };
    const ms = Math.round(performance.now() - began);
    noteProcess(cmd, cwd, env.BUN_AOT_START_AT, ms, Number(child.resourceUsage()?.cpuTime.total ?? 0) / 1000);
    return { output, ms, peakMB: Math.round(held.peak / 2 ** 20) };
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
// A Bun built with assertions keeps the line breaks of the built-ins written in JavaScript, so plain Bun prints `map (native:17:41)` there.
// An executable has the positions of a release build, `map (native:1:11)`, and so has a stored output.
// A program may print the line alone: `iter (native:4)` there, `iter (native:3)` in an executable.
const comparedWithPlain = (output: Output) => {
  const { stdout, ...rest } = compared(output);
  return { ...rest, stdout: isASAN ? stdout.replace(/\b(native|unknown):\d+(?::\d+)?/g, "$1") : stdout };
};
/** The lines of `text` that are not the same in `other`, each with the line before and the line after it. */
function differingLines(text: string, other: string) {
  const [lines, others] = [text.split("\n"), other.split("\n")];
  const kept: string[] = [];
  let same = 0;
  const countSame = () => void (same && kept.push(`(${same} lines that are the same)`), (same = 0));
  lines.forEach((line, at) => {
    if ([at - 1, at, at + 1].some(near => near >= 0 && near < lines.length && lines[near] !== others[near])) {
      countSame();
      kept.push(line);
    } else same++;
  });
  countSame();
  return kept.join("\n");
}
const shown = (output: Output) => ({
  ...output,
  stdout: output.stdout.slice(0, longestTextShown),
  stderr: output.stderr.slice(0, longestTextShown),
});

const withoutLinesOfImage = (stderr: string) =>
  stderr.replace(/^\[aot\] (?!type-mismatch \S+ \S+ (?!internal:|bun:|node:)).*\r?\n/gm, "");

const waysLeft = new Map<string, number>();
const verdicts = new Map<string, Record<string, unknown>[]>();
/** A file has one verdict: of the ways that fail the first build, or else whichever failed first; or else the first. */
function settle(program: Program, verdict: Record<string, unknown>) {
  if (program.todoOfWay !== undefined)
    verdict =
      verdict.state === "fail" || program.todoOfWay.startsWith("Not every time:")
        ? { state: "todo" }
        : {
            state: "fail",
            stage: "todo",
            message: `${program.way}: it passes: its \`// Todo alone ..:\` line goes out`,
          };
  const all = [...(verdicts.get(program.file) ?? []), { file: program.file, way: program.way, ...verdict }];
  verdicts.set(program.file, all);
  if (all.length < waysLeft.get(program.file)!) return;
  const sum = (name: string) => all.reduce((total, verdict) => total + Number(verdict[name] ?? 0), 0);
  const failed = all.some(({ state }) => state === "fail");
  if (program.todo !== undefined) {
    if (failed || moreFlags.length || program.todo.startsWith("Not every time:"))
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
    ...(all.find(({ state, way }) => state === "fail" && way === "compiled") ??
      all.find(({ state }) => state === "fail") ?? {
        ...all.find(({ state }) => state !== "todo"),
        compileMs: sum("compileMs"),
        runMs: sum("runMs"),
        plainMs: sum("plainMs"),
        // Of the way that asked.
        ...Object.fromEntries(
          ["shellMs", "countsNotAsked"].flatMap(name =>
            all.filter(verdict => name in verdict).map(verdict => [name, verdict[name]]),
          ),
        ),
      }),
    ways: Object.fromEntries(all.map(({ way, state }) => [way, state])),
  });
}
// A long output is cut where it is shown, and the cut must not hide the difference.
const leavingOutTheSame = (output: Output, other: Output) => ({
  ...output,
  stdout: differingLines(output.stdout, other.stdout),
  stderr: differingLines(output.stderr, other.stderr),
});
function fail(program: Program, stage: string, message: string, actual?: Output, expected?: Output) {
  settle(program, {
    state: "fail",
    stage,
    message:
      program.way === "erased"
        ? `with --aot-erase-types: ${message}`
        : program.way === "compiled"
          ? message
          : `${program.way}: ${message}`,
    expected: expected && shown(actual ? leavingOutTheSame(expected, actual) : expected),
    actual: actual && shown(expected ? leavingOutTheSame(actual, expected) : actual),
  });
}

/** Only a COUNT names what is counted with its kind in front. */
function readBound(line: string) {
  const [, kind, name, relation, bound, todo] =
    /^\/\/ (STATISTIC|COUNT|COUNTER): ([\w:]+) (=|>=|<=) (\d+)(?: Todo: (.+))?$/.exec(line) ?? [];
  if (kind === undefined || (kind !== "COUNT" && name.includes(":"))) return undefined;
  return { kind, name, relation, bound: Number(bound), todo };
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
  const flags = [...words("Flags"), ...moreFlags.filter(flag => !words("Flags").includes(flag))];
  const others = /[\\/]main\.[a-z]+$/.test(path)
    ? readdirSync(dirname(path), { recursive: true, encoding: "utf8" })
        .filter(name => /\.[cm]?[jt]sx?$/.test(name) && !name.includes("node_modules"))
        .map(name => join(dirname(path), name))
        .filter(other => other !== path && statSync(other).isFile())
    : [];
  const texts = [text, ...others.map(other => readFileSync(other, "utf8"))];
  const boundLines = texts.flatMap(text =>
    Array.from(text.matchAll(/^\/\/ (?:STATISTIC|COUNT|COUNTER):.*$/gm), ([line]) => line),
  );
  const bounds = boundLines.map(readBound).filter(bound => bound !== undefined);
  // Without whole-program analysis an executable holds the whole library.
  const namesModules =
    flags.includes("--aot-disable=flow-results") || someFileOf(path, text => namesMuchOfTheLibrary.test(text));
  return {
    file,
    path,
    flags,
    env: Object.fromEntries(lines("Env").map(line => line.split(/=(.*)/s).slice(0, 2))),
    envOfExecutable: Object.fromEntries(lines("Env of the executable").map(line => line.split(/=(.*)/s).slice(0, 2))),
    envOfBuild: Object.fromEntries(lines("Env of the build").map(line => line.split(/=(.*)/s).slice(0, 2))),
    buildPrints: lines("Build prints").map(line => {
      const [, times, text] = /^(\d+) x (.*)$/.exec(line)!;
      return { times: Number(times), line: text };
    }),
    entryPoints: words("Entry points"),
    comparesWithCompiled: lines("Reference").includes("bun build --compile"),
    erasedIsAsPlain: lines("Erased types").includes("as plain Bun"),
    isBuiltErased: !lines("Erased types").some(line => line.startsWith("not built")),
    isAlone: eachAlone || lines("Alone").length > 0,
    printsWhatIsSaved: lines("Prints what the compiler saves").length > 0,
    isNeverAlone: lines("Never alone").length > 0,
    runsByItself: lines("Runs by itself").length > 0,
    weight: tookMs.has(path)
      ? Math.max(8, Math.round(tookMs.get(path)! / msOfWeight))
      : namesModules || someFileOf(path, text => handsOutObjectOfHost.test(text))
        ? 8
        : 1,
    namesModules,
    writesToBuiltIn: writesToBuiltIn.test(text),
    exitCode: Number(lines("Exit code")[0] ?? 0),
    todo:
      (isASAN ? lines("Todo under ASAN")[0] : undefined) ??
      lines(`Todo on ${process.platform} ${process.arch}`)[0] ??
      lines("Todo")[0],
    todoOfWays: way =>
      lines(`Todo ${way}`)[0] ??
      (way === "alone" ? undefined : lines("Todo alone under a check")[0]) ??
      lines("Todo alone")[0],
    statistics: bounds.filter(({ kind }) => kind === "STATISTIC"),
    counts: bounds.filter(({ kind }) => kind !== "STATISTIC"),
    boundsNotRead: boundLines.filter(line => !readBound(line)),
    asksTheShell: texts.some(text => namesFunctionThatCounts.test(text)),
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

/**
 * As it stands in the comment Output. What is stored names the files of an executable as they are named elsewhere than on Windows.
 * What an option of the engine logs goes through the C library, which on Windows ends a line with a carriage return and a line feed.
 */
const asText = ({ exitCode, stdout, stderr }: ReturnType<typeof compared>) =>
  (stdout + (exitCode ? `exit code ${exitCode}\n${stderr}\n` : stderr.replaceAll("\r\n", "\n"))).replace(
    /B:\\~BUN\\root[^\s'":]*/g,
    path => "/$bunfs/root" + path.slice(12).replaceAll("\\", "/"),
  );

function countedByBuild(buildOutput: string) {
  const counted = new Map(
    Array.from(buildOutput.matchAll(/^(\w+) (\d+)$/gm), ([, name, value]) => [name, Number(value)] as const),
  );
  const emitted = counted.get("ImageFunctionsEmitted");
  if (emitted !== undefined)
    counted.set("ImageFunctionsAndJumpsInTheirPlace", emitted + (counted.get("JumpOnlyFunctionsRemoved") ?? 0));
  return counted;
}

/** What the file that BUN_JSC_aotCountsPath names holds: each line under its name, and the lines of a kind together. */
function countedByRun(text: string) {
  const counted = new Map([
    ["operations", 0],
    ["arrivals", 0],
    ["branches", 0],
    ["arrivalsAndBranches", 0],
    ["cells", 0],
    ["bytes", 0],
    ["allCells", 0],
  ]);
  const add = (name: string, count: number) => counted.set(name, (counted.get(name) ?? 0) + count);
  for (const line of text.split("\n")) {
    if (line.startsWith("allocation ")) {
      add("cells", Number(line.split(" ").at(-2)));
      add("bytes", Number(line.split(" ").at(-1)));
    }
    // The free lists that were used up. Cells that the run time allocates for the program count here too.
    if (line.startsWith("refill ")) add("allCells", Number(line.split(" ").at(-2)));
    const [count, name] = line.split("\t");
    if (name === undefined) continue;
    add(name, Number(count));
    // As a COUNTER names it.
    if (/^(?:counter|exit|limit|operation):/.test(name)) add(name.slice(name.indexOf(":") + 1), Number(count));
    // How arrivals are counted is no call that the program makes.
    if (name.startsWith("operation:") && name !== "operation:operationAOTRecordArrival")
      add("operations", Number(count));
    else if (name.startsWith("arrival:")) add("arrivals", Number(count));
    else if (name.startsWith("branch:")) add("branches", Number(count));
    if (name.startsWith("arrival:") || name.startsWith("branch:")) add("arrivalsAndBranches", Number(count));
  }
  return counted;
}
// A collection drops what the run time has learned about some places, and when one comes depends on the clock.
const withoutCollections = {
  BUN_GC_TIMER_DISABLE: "1",
  BUN_JSC_percentCPUPerMBForEdenTimer: "0",
  BUN_JSC_percentCPUPerMBForFullTimer: "0",
  BUN_JSC_smallHeapSize: "2000000000",
  BUN_JSC_largeHeapSize: "2000000000",
};

function unmetBounds(counted: Map<string, number>, bounds: Bound[], who: string) {
  return bounds.flatMap(({ name, relation, bound, todo }) => {
    // With AddressSanitizer the allocators have shorter free lists, so compiled code calls the run time for a new one more often.
    if (isASAN && name === "operations") return [];
    // A Bun built with AddressSanitizer folds no null check into an access: it counts 0.
    if (isASAN && name === "NullChecksFoldedIntoAccesses") return [];
    // A function of the run time that nothing called has no line.
    const operation = /^(?:operation:)?(operationAOT\w+)$/.exec(name)?.[1];
    const most = counted.has(name) ? counted.get(name)! : operation ? 0 : undefined;
    if (most === undefined) return [`${name} ${relation} ${bound}, but the ${who} counted nothing of that name`];
    // The same shorter free lists make a function that also refills one count more. An entry that refilled one came for that alone, or is one of those
    // asked about and found the list empty on its way: the counts do not tell. Those asked about are as many as one of the numbers from `least` to `most`.
    const refills = isASAN && operation ? (counted.get("refilled:" + operation) ?? 0) : 0;
    const least = most - refills;
    const meets = (value: number) =>
      relation === "=" ? value === bound : relation === ">=" ? value >= bound : value <= bound;
    if (todo !== undefined)
      return meets(least) && meets(most) ? [`${name} ${relation} ${bound} is met: its \`Todo:\` goes out`] : [];
    const someNumberMeets = relation === "=" ? least <= bound && bound <= most : meets(least) || meets(most);
    const refilled = refills > 0 ? `, ${refills} of them with a free list to refill` : "";
    return someNumberMeets ? [] : [`${name} ${relation} ${bound}, but the ${who} counted ${most}${refilled}`];
  });
}

let toolsOfTheShell: { env?: Record<string, string | undefined>; python?: string; whyNot?: string } | undefined;
/** Looked for when the first program asks: to see whether this Bun is a front end takes a build. */
function findToolsOfTheShell() {
  const jsc = process.env.JSC ?? findTool(process.execPath, "jsc");
  const testaot = process.env.TESTAOT ?? findTool(process.execPath, "testaot");
  const python = Bun.which("python3");
  const { BUN_AOT_VERBOSE: _, ...env } = environmentOfBuilds;
  const frontEnd =
    process.env.FRONT_END ??
    (!isWindows && jsc && testaot && python && canWriteProgram(process.execPath, env) ? process.execPath : undefined);
  const whyNot = whyNoScriptStarts(process.execPath, undefined, { jsc, testaot, python, frontEnd });
  if (whyNot) return { whyNot };
  return {
    python: python!,
    env: {
      ...env,
      JSC: jsc,
      TESTAOT: testaot,
      FRONT_END: frontEnd,
      PLAIN: process.execPath,
      PROGRAMS: root,
      WORK: join(folder, "shell"),
      KNOWS_SHELL_FUNCTIONS: "1",
    },
  };
}
const countsNotAsked: string[] = [];
type Asked = { failure?: string; output?: Output; shellMs?: number; countsNotAsked?: string };
/**
 * What a program says about the answers of a function that the shell alone has. `failure`: it does not hold. `countsNotAsked`: why nobody can tell here.
 * A program that the shell cannot run fails too: nothing else holds its counts. shell/counts-known.txt lists what does not hold today.
 */
async function askTheShell(program: Program): Promise<Asked> {
  const { python, env, whyNot } = (toolsOfTheShell ??= findToolsOfTheShell());
  if (whyNot) {
    countsNotAsked.push(program.file);
    return { countsNotAsked: whyNot };
  }
  const path = relative(root, program.path).replaceAll("\\", "/");
  const name = /\/main\.[a-z]+$/.test(path) ? dirname(path) : path.replace(/\.[a-z]+$/, "");
  // A front end, a build and three runs.
  const { output, ms } = await withSlot(() => start([python!, quick, name], root, env!, 3 * timeLimit([])));
  const verdict = output.stdout
    .split("\n")
    .find(line => line.startsWith(`${name}: `))
    ?.slice(name.length + 2);
  if (verdict === undefined || output.overLimit)
    return { failure: `shell/quick.py ended with ${describeEnd(output)} and has no verdict`, output };
  if (verdict.startsWith("skipped: TODO: ")) return { shellMs: ms, countsNotAsked: verdict.slice("skipped: ".length) };
  return /^same \(\d+ lines\)$/.test(verdict) ? { shellMs: ms } : { failure: `in the jsc shell: ${verdict}`, output };
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
  if (first.boundsNotRead.length)
    return fail(
      first,
      "read",
      `not of the form \`// STATISTIC | COUNT | COUNTER: <name> (= | >= | <=) <n>\`: ${first.boundsNotRead.join("; ")}`,
    );
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
    ...(first.counts.some(({ name }) => ["arrivals", "arrivalsAndBranches"].includes(name))
      ? ["--aot-count-arrivals"]
      : []),
    // Only such a build counts every cell. Any other books a whole free list to the place that finds it used up.
    ...(first.counts.some(({ name }) => ["branches", "arrivalsAndBranches", "cells", "bytes"].includes(name))
      ? ["--aot-count-branches"]
      : []),
    ...entryPoints,
    ...first.entryPoints,
    "--outfile",
    executable,
  ];
  const build = await withSlotsOfBuild(expectedTimeOf(programs), threads => {
    for (const { file, way } of programs) say((lastTaken = { file, way, state: "compiling" }));
    const cmd = command(threads);
    return start(cmd, buildsIn, { ...environmentOfBuilds, ...first.envOfBuild }, timeLimit(cmd, weightOf(programs)));
  });
  const remove = noteExecutable(executable);
  try {
    // Nothing starts from it, and its programs may be built again.
    if (build.output.exitCode !== 0) remove();
    if (build.output.overLimit) {
      const still = build.output.stderr.split("\n").filter(line => line.startsWith("Still "));
      if (programs.length > 1) {
        const notice = `A build of ${programs.length} programs is made again in parts: ${build.output.overLimit}.`;
        console.error([notice, ...still].join("\n  "));
        return void (await inParts(8));
      }
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
    const unmet =
      first.way === "compiled" && !moreFlags.length
        ? unmetBounds(countedByBuild(build.output.stderr), first.statistics, "build")
        : [];
    const printed = build.output.stderr.split(/\r?\n/);
    for (const { times, line } of moreFlags.length ? [] : first.buildPrints) {
      const found = printed.filter(text => text === line).length;
      if (found !== times) unmet.push(`the build prints ${found} x ${line}, not ${times} x`);
    }
    if (unmet.length) return fail(first, "compile", unmet.join("; "), build.output);
    // Of the time of a build each program has the share that its code has of all the code: a program says how much it has when it starts.
    const codeBytes = programs.map(() => Promise.withResolvers<number>());
    await Promise.all(
      programs.map(async (program, index) => {
        const env = {
          ...environment,
          ...program.env,
          ...(!isAlone && { BUN_AOT_START_AT: entryPoints[index].slice(2) }),
        };
        const cwd = dirname(program.path);
        const stored = program.way === "erased" && program.erasedIsAsPlain ? undefined : program.output;
        const withSlotOfRun = program.runsByItself ? withEverySlot : withSlot;
        const runReference = async () => {
          if (!program.comparesWithCompiled)
            return withSlotOfRun(() => start([process.execPath, program.path], cwd, env));
          const other = nextExecutable("reference");
          let remove = () => {};
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
                environmentOfBuilds,
              ),
            );
            remove = noteExecutable(other);
            if (built.output.exitCode !== 0) return built;
            return await withSlotOfRun(() => start([other], cwd, env));
          } finally {
            remove();
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
        // A file for each process: the program may start itself again.
        const counts =
          program.way === "compiled" && program.counts.length && !moreFlags.length
            ? `${basename(executable)}.counts-`
            : undefined;
        const compiled = await withSlotOfRun(() =>
          start([executable], cwd, {
            ...env,
            ...(counts && { ...withoutCollections, BUN_JSC_aotCountsPath: join(folder, `${counts}%p`) }),
            ...program.envOfExecutable,
          }),
        );
        codeBytes[index].resolve(
          Number(/^\[aot\] image: \d+ bytes, (\d+) of code/m.exec(compiled.output.stderr)?.[1] ?? 0),
        );
        if (compiled.output.overLimit)
          return fail(program, "run", `it ended by ${describeEnd(compiled.output)}`, compiled.output);
        const written = counts ? readdirSync(folder).filter(name => name.startsWith(counts)) : [];
        const counted = countedByRun(written.map(name => readFileSync(join(folder, name), "utf8")).join(""));
        for (const name of written) rmSync(join(folder, name), { force: true });
        const plain = await reference();
        const isRefused = ({ stdout, stderr }: Output) => saysWhatWasLeftOut.test(stdout + stderr);
        if (!isAlone && sharesLibrary(first) && isRefused(compiled.output) && !(plain && isRefused(plain.output)))
          return run([{ ...program, isAlone: true }]);
        if (compiled.output.signal)
          return fail(program, "run", `it ended by ${describeEnd(compiled.output)}`, compiled.output, plain?.output);
        // The executable ran compiled code and did not fall back to the source it holds.
        if (!compiled.output.stderr.includes("[aot] module: "))
          return fail(program, "run", "it did not run compiled code", compiled.output, plain?.output);
        compiled.output.stderr = withoutLinesOfImage(compiled.output.stderr);
        const unmet = counts ? unmetBounds(counted, program.counts, "executable") : [];
        if (unmet.length) return fail(program, "count", unmet.join("; "), compiled.output, plain?.output);
        const ofEach = await Promise.all(codeBytes.map(({ promise }) => promise));
        const ofAll = ofEach.reduce((sum, bytes) => sum + bytes, 0);
        const passes = {
          state: "pass",
          compileMs: Math.round(build.ms * (ofAll ? ofEach[index] / ofAll : 1 / programs.length)),
          runMs: compiled.ms,
          buildMB: build.peakMB,
          runMB: Math.max(compiled.peakMB, plain?.peakMB ?? 0),
        };
        const settleChecked = async (passed: typeof passes & { plainMs?: number }) => {
          const asksNow = program.asksTheShell && program.way === "compiled" && !moreFlags.length;
          const { failure, output, ...asked }: Asked = asksNow ? await askTheShell(program) : {};
          if (failure) return fail(program, "count", failure, output);
          const result = { ...passed, ...asked };
          if (!checksAtRunTime) return settle(program, result);
          const checked = await withSlotOfRun(() =>
            start([executable], cwd, { ...env, ...program.envOfExecutable, BUN_JSC_validateAOTRuntime: "1" }),
          );
          const said = /^.*AOT validation:.*$/m.exec(checked.output.stderr)?.[0];
          if (said) return fail(program, "checks", said, checked.output);
          checked.output.stderr = withoutLinesOfImage(checked.output.stderr);
          if (program.printsWhatIsSaved || Bun.deepEquals(compared(checked.output), compared(compiled.output)))
            return settle(program, result);
          const message = "with the checks of the run time on it does not exit and print as without them";
          fail(program, "checks", message, checked.output, compiled.output);
        };
        if ((moreFlags.length || program.hasCheck) && program.printsWhatIsSaved) return settleChecked(passes);
        if (stored !== undefined) {
          if (asText(compared(compiled.output)) === stored) return settleChecked(passes);
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
        if (Bun.deepEquals(comparedWithPlain(compiled.output), comparedWithPlain(plain!.output)))
          await settleChecked({ ...passes, plainMs: plain!.ms });
        else fail(program, "compare", "it does not exit and print as plain Bun does", compiled.output, plain!.output);
      }),
    );
  } finally {
    remove();
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
// Whoever deals asks what belongs together. What a Bun cannot build is said where the programs are run.
const deals = process.argv.includes("--deal");
if (files.length < given.length) {
  const leftOut = given.filter(file => !isInEveryBuild(file));
  const message = "not in every build: AOT_WHOLE=1, or [aot whole] in the message of the commit, takes it";
  // Whoever deals wants each program once.
  if (deals)
    for (let at = 0; at < leftOut.length; at += 250)
      console.log(JSON.stringify({ ms: 0, files: leftOut.slice(at, at + 250) }));
  else for (const file of leftOut) say({ file, state: "skip", message });
  if (!files.length) process.exit(0);
}
if (whySkipped && !deals) {
  for (const file of files) say({ file, state: "skip", message: whySkipped });
  console.error(`SKIPPED all ${files.length} programs: ${whySkipped}`);
  process.exit(0);
}
// A Bun that cannot do this much passes nothing: no program is left out for it.
const whyNothingStarts = deals ? undefined : findWhyNothingStartsWhereItIsTold();
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
  program.runsByItself ||
  program.comparesWithCompiled ||
  program.entryPoints.length > 0 ||
  program.statistics.length > 0 ||
  program.counts.length > 0 ||
  program.boundsNotRead.length > 0 ||
  program.buildPrints.length > 0 ||
  Object.keys(program.envOfBuild).length > 0 ||
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
const isDrawn = ({ path }: Program, flags: string[], oneIn: number) =>
  (BigInt(Bun.hash(`${relative(root, path).replaceAll("\\", "/")} ${flags.join(" ")}`)) + BigInt(day)) %
    BigInt(oneIn) ===
  0n;
const all = [
  ...asWritten,
  ...(erases
    ? asWritten
        .filter(
          program =>
            program.isBuiltErased && !program.namesModules && program.buildErrors === undefined && hasTypes(program),
        )
        .map(program => ({ ...program, way: "erased" as const }))
    : []),
  ...buildsAlone.flatMap(({ flags, oneIn }) =>
    asWritten
      .filter(
        program =>
          program.buildErrors === undefined &&
          !program.isNeverAlone &&
          !(isBuiltAlone(program) && flags.every(flag => program.flags.includes(flag))) &&
          isDrawn(program, flags, oneIn),
      )
      .map(program => {
        const way = ["alone", ...(flags.length ? ["under", ...flags] : [])].join(" ") as Program["way"];
        return {
          ...program,
          way,
          hasCheck: flags.length > 0,
          todoOfWay: program.todoOfWays(way),
          isAlone: true,
          // Its files are named from its own folder on.
          output: isBuiltAlone(program)
            ? program.output
            : program.output?.replaceAll(
                `/$bunfs/root/${relative(root, dirname(program.path)).replaceAll("\\", "/")}/`,
                "/$bunfs/root/",
              ),
          flags: [...program.flags, ...flags.filter(flag => !program.flags.includes(flag))],
          statistics: [],
          counts: [],
          boundsNotRead: [],
          buildPrints: [],
          asksTheShell: false,
        };
      }),
  ),
];
if (buildsAlone.some(({ oneIn }) => oneIn > 1))
  console.error(`DAY ${day}: some builds alone take a part of the programs. AOT_DAY=${day} takes the same part.`);
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
    // Among themselves: they take nothing from whoever writes nothing.
    !program.namesModules && program.writesToBuiltIn,
    twins.get(withoutExtension(program.path))!.findIndex(({ path }) => path === program.path),
  ]),
);
const batches = [...groups.values()].flatMap(group => {
  const sizeOf = (programs: Program[]) => (sharesLibrary(group[0]) ? programs.length : weightOf(programs));
  const limit = sharesLibrary(group[0]) ? entryPointsOfOneProgram : programsInOneExecutable;
  const most = Math.ceil(sizeOf(group) / Math.ceil(sizeOf(group) / limit));
  const batches: Program[][] = [[]];
  for (const program of group) {
    if (batches.at(-1)!.length && sizeOf([...batches.at(-1)!, program]) > most) batches.push([]);
    batches.at(-1)!.push(program);
  }
  return batches;
});
batches.sort((one, other) => expectedTimeOf(other) - expectedTimeOf(one));
expectedTimeOfAll = batches.reduce((sum, batch) => sum + expectedTimeOf(batch), 0);
// Every shard must deal alike, at whatever hour it starts: a build that a day draws counts for each program by its share.
const weightOfBuildsAlone = (programs: Program[]) =>
  programs.reduce((sum, { weight }) => sum + (weight > 1 ? 15 : 3), 0) *
  buildsAlone.reduce((sum, { cost, oneIn }) => sum + cost / oneIn, 0);
if (deals) {
  for (const batch of batches)
    if (batch[0].way === "compiled")
      console.log(
        JSON.stringify({
          ms: (weightOf(batch) + weightOfBuildsAlone(batch)) * msOfWeight,
          files: batch.map(({ file }) => file),
        }),
      );
  process.exit(0);
}
const runs = batches.map(run);
void Promise.all(runs.filter((_, index) => !batches[index][0].runsByItself)).then(() => othersAreThrough.resolve());
await Promise.all(runs);
if (toolsOfTheShell?.whyNot)
  console.error(
    `NOT ASKED: ${countsNotAsked.length} programs ask the jsc shell what compiled code did, and ${toolsOfTheShell.whyNot}. ` +
      `Nothing that they say about a count is held here: test/aot/counts-pinned-by-programs.test.ts holds it. ${countsNotAsked.join(" ")}`,
  );
console.error(describeTime());
process.exit(hasFailed ? 1 : 0);
