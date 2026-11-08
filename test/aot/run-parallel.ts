// Runs the programs under ./parallel: each must exit and print under `bun build --compile --aot` as it does under `bun <file>`.
//
//   bun test/aot/run-parallel.ts test/aot/parallel/classes/super-call.ts ..
//   bun test/aot/run-parallel.ts --jobs=4 --files-from=<a file with one path a line>      as scripts/runner.node.ts starts it
//   --no-erased       leaves out every build but the first: for whoever asks the system or this driver, and not the compiler. scripts/runner.node.ts says it
//   --under="<flags>"   behind its first build every program has one more, with these flags, and no other: how a bench looks for what nobody knows of yet
//   --one-guess-in=<n>   see below: which guesses fail on purpose in the build that has such. `<n>:<seed>` draws other turns. Never 1
//   --root=<folder>   the programs lie under that folder, not under ./parallel
//   --memory=<MB>     what all that runs at once may hold together. Without it: seven eighths of what the machine has available at the start
//   --seconds=<n>     the time limit of a run. Default: 90, or 240 under ASAN
//   --more-flags="--aot-check=Validate"   every build takes these flags too: the programs under the compiler's own checks. A check counts, prints and
//                     keeps more than a build without it: what a program says that a build counts or prints is not asked, and no `// Todo:` is held to fail
//   --env-of-the-executable="A=b C=d"   every executable runs with these variables too. No build does, and no reference: the programs under a collector that is forced, say.
//                     What a run counts, how it grows and what it prints of what the compiler saves hang on when the collector runs: they are not asked, and no `// Todo:` is held to fail
//   --instructions    how a program grows with its data, or a build with its program, is counted in instructions (`perf stat`, Linux), not taken from the clock: the same on a machine that is shared
//   --deal            builds and runs nothing: prints a line for each program, { ms, files }, with what all its builds take. scripts/runner.node.ts deals the programs to the shards by it
//   --keep-statistics   the first build of every program is asked what it counted, and the line of the file says it: `statistics: { <name>: <n>, .. }`, without the zeros:
//                     for whoever sums over all programs how often each mechanism of the compiler fires, build of Bun by build of Bun. CI does not say it
//
// THE FRAMES OF A STACK TRACE ARE NOT HELD TO PLAIN BUN: their number, names, lines and columns. The message is. A program that does not print as its reference does is compared once more
// without the lines that are frames and without the place behind the name of a file (`main.js:3:14`). If it still differs it may print frames as data (`error.stack.split("\n")[1]`): it is built and run once more,
// and so is its reference, behind a module that gives every stack trace the same ten frames (Error.prepareStackTrace). It passes if the two agree then, all four runs end alike,
// and each line in which the first two differ is another line behind that module ON BOTH SIDES: a line that plain Bun prints the same with other frames holds no frame, and what differs in it counts.
// (The second build is another program, and in other company a fault may not show.)
// A program that asks which file it began with (process.mainModule, require.main, import.meta.main, module.parent) is not built once more: behind that module every such answer is another one
// on both sides, frames or no frames, so a wrong line would pass.
// The line of a program that passes so says `framesDiffer: true`, and the last line of the run says how many did, and how many are skipped by a `// Todo: only frames (..): <why this driver cannot tell>`.
//
// THE REFERENCE IS ASKED AGAIN WHERE THE TWO PART. `bun <file>` itself answers otherwise once in some hundred runs of some programs.
// It is run again, twice at most, and the program passes if one of those runs ends and prints as the executable did.
// The executable is not run again: what it printed stands, so an executable that answers now one way, now the other, fails as ever. Not under a mark: that stands for a difference.
// The line of a program that passes so says `referenceWavered: true`, stderr names it at once, and the last lines of the run name them all.
//
// Every program is built in each way of harness/ways.ts: as written, and with its types erased.
// Each executable is held to the same run of plain Bun. Only the first build is asked what the program says that a build counts or prints.
// A program that says `// Under: <flags>: <why>` is built once more with those flags: it is the witness of a fault that showed only there.
// And every program is built once more with --aot-testing=FailGuesses:<n>: one guess in n fails on purpose though its value would have passed. So each program with a loop or a guess walks the ways
// from its typed copies into the closed ones, which its own values seldom or never take, and must still print what plain Bun prints. n is 3, 2 and 7 in turns, by the number of CI's build, and 3
// anywhere else; the way in the line of a program names it. With 1 no typed copy is entered at all, and nothing is seen.
//
// Every program is built by itself, as anybody builds it: in its folder, with nothing but --compile --aot, a number of threads and its flags. What a build makes of a program
// goes by all that the build holds, and beside others a fault may not show: so nothing here is ever joined into one program, also not to compile Bun's library once for many.
//
// A program may begin with comment lines that say how it is built and run:
//   // Flags: --aot-huge-heap          more flags for the build. A word that begins with ./ or ../ is a path from the folder of the program
//   // Entry points: ./child.cjs       further entry points, for what the program loads under a computed name. The program is what starts
//   // Runs by itself: <why>           it keeps more threads busy than a machine has processors: its runs come last, each with nothing beside it
//   // Env: TZ=America/New_York        the environment of both runs, one variable a line
//   // Env of the executable: A=b       the same, for the executable alone
//   // Env of the build: A=b            the same, for the build alone
//   // Build prints: 2 x <line>         how often the build prints exactly that line
//   // Reference: bun build --compile  it is compared with an executable built without --aot, with the flags that do not begin with --aot
//   // Exit code: 3                    what both runs end with. Without the line a reference that does not end with 0 fails the program: two runs that
//                                      stop at the same error agree and show nothing
//   // Todo: <what>: <why>             it does not pass today. It is run all the same and reported as skipped, and fails once it passes: the line goes out.
//                                      It stands for the one difference that <what> names, and the program fails by any other:
//                                        it grows                  how it or its build grows is over its bound. What it prints is held as ever
//                                                                  Whether a build's mark is met is said only where instructions are counted: elsewhere half of its bound is not asked
//                                        "collected" | "KEPT"      it prints one of the two words where its reference prints the other. Everything else that the two print, and how they end, is held as ever
//                                        only frames (..)          see above
//                                      A line that says none of the three fails the program, on whatever platform the line is for.
//                                      No `Todo` of any kind and no `Skip` stands for a death: what a signal ends, what passes a limit of time or memory, a report of a sanitizer,
//                                      a failed assertion and an internal compiler error fail the program whatever it is marked with
//   // Todo on win32 x64: <why>        the same where process.platform and process.arch are those two, and nothing anywhere else. There it goes before a `// Todo:`
//   // Skip on win32 x64: <why>        where process.platform and process.arch are those two, what it prints is compared with nothing, and it is reported as skipped:
//                                      for a program whose reference, `bun <file>`, answers now one way, now the other there. It is built and run all the same,
//                                      and its line says in which lines the two differed in this run
//                                      Nothing anywhere else. There is no such line for every platform
//   // Skip under ASAN: <why>          the same where Bun is built with the address sanitizer
//   // Todo under ASAN: <why>          the same where Bun is built with the address sanitizer, and nothing anywhere else. There it goes before the other two
//                                      How a program or its build grows is not asked under ASAN, so no `// Todo:` of a program that says `// Grows:` is held to fail there
//   // Todo under --aot-erase-types: <why>   its build with those flags does not pass today. The others are held as ever. It fails once that one passes: the line goes out.
//   // Todo under a check: <why>       the same for every build with --aot-check= among its flags
//   // Under: <flags>: <why>           it is built once more with those flags, and held to the same. A line for each such build
//   // Prints what the compiler saves: <what>   its output counts cells, promises or the like. What it prints is compared in the first build alone, and not under --more-flags.
//                                      Every other build is made and run: `ways` says "built and run, not compared" of it, not "pass"
//   // Prints what goes by the copy that runs: <what>   the same, for what the language leaves open and a typed copy of its code answers otherwise than the closed one: the bytes of a NaN
//   // STATISTIC: <name> (= | >= | <=) <n>   what the build must have counted
//   // COUNT: <name> (= | >= | <=) <n>       what the executable of the first build must have counted when it ends: no clock, and the same on every machine.
//                                      A name as BUN_JSC_aotCountsPath writes it (operation:operationAOTGetById, counter:CompiledStructuresMade), or
//                                      `operations`: all calls into the run time. The run has no collection. What the program starts counts too
//   // COUNTER: <name> (= | >= | <=) <n>     the same, with the name without its kind (CompiledStructuresMade, operationAOTGetById)
//                                      Each of the three may end with ` Todo: <why>`: it is not met today. It is asked all the same, and fails once it is met: the words go out.
//                                      ` Todo on win32: <why>`: the same where process.platform is that, and the bound is held as ever anywhere else.
//                                      ` Todo on linux x64: <why>`: where process.arch is the second word too: how often the allocator asks for room hangs on it.
//                                      What was counted for it stands in the line of the file: `goalsNotMet: { "<name> <= <n>": <counted> }`. The bound alone says
//                                      neither how far off it is nor that it moves further off: tools/goals-that-grew.ts holds two runs against one another.
//                                      The rest of the program is held as ever. A name that nothing counts fails with or without them.
//                                      A line that begins like one of the three and is not of that form fails the program: nothing that looks like a bound is passed over.
//                                      In a folder with a main file they may stand in any file: none of the others is a program
//   // Sizes: 1000 4000 16000          what one piece of its data costs must not hang on how much data there is. The program makes its data of the size that SIZE says and
//   // Passes: 350                     does its deed PASSES times over. Three sizes, each four times the one before. The executable of the first build is run at each, and
//   // Grows: linear                   (t(16n) - t(4n)) / (t(4n) - t(n)) is at most 9: the differences strike out the start, linear gives 4, n log n less than 5, a square 16.
//                                      t is the time the processors spent in the program, and the passes are raised until the smallest run takes 50 ms. Only what is over
//                                      the bound is run twice more, and judged by the least at each size. Under --instructions t is a count, and the bound is 6.
//                                      All three lines or none. Not asked under --more-flags or ASAN.
//                                      Whoever writes one: the passes make some 200 M instructions at the smallest size; what it keeps alive stays small (past some 30,000
//                                      cells a unit costs twice as much, once, in plain Bun too: three sizes cannot tell that step from a square); plain Bun is linear in it
//   // Grows: the build, linear        the program is a WRITER: it prints a program of the size SIZE that holds PASSES copies of its function under names of their own. Any three
//                                      rising sizes. Each of the three programs is built with one thread, and its executable must print what plain Bun prints of it. What the
//                                      build holds at its peak may rise by 200 bytes for each byte that the program grows by (the dearest takes 70), and 32 MB.
//                                      The peak is the largest resident set that the kernel counted for the build. It holds what is mapped from files too, which is the same
//                                      at all three sizes. What a watcher sees in looks 50 ms apart differs from one run to the next by more than the 32 MB leave room for.
//   // Room of the peak: 62 MB: <why>  in place of the 32 MB, for a writer whose short lines each copy much code in line: its peak rises in line with its size and by more than its
//                                      text says. The why names the cause and the numbers that were read.
//                                      WHERE INSTRUCTIONS ARE COUNTED what the build takes must grow as the size does: (t3 - t2) / (t2 - t1) is at most 1.5 times (s3 - s2) / (s2 - s1).
//                                      That is under --instructions, and without it wherever Linux lets this process open a counter of its own (in CI: Alpine on x64, as for build-scaling).
//                                      Only a count says that: a build has a long start of its own, and by the clock what lies between two builds drowns in it
//   // Grows: the build, a square      the same, held against the squares of the sizes: what is so today and ought to be linear. Work that doubles with each step is over both
// Those lines may also stand at the end, in front of the last comment: a stored output may name lines of the program, and a line more at the top moves them.
// It may end with a comment that says what is expected where that is not what plain Bun does:
//   /* Output: .. */                   what the executable prints. Behind a line `exit code <n>` stands the line that names the error
//   /* Build errors: .. */             the build ends with exit code 1 and these `error:` lines
//
// Prints a line of JSON when it takes a file ({ file, state: "compiling" }) and one when the file is through
// ({ file, state: "pass", compileMs, runMs, plainMs, buildMB, runMB, plainMB }, { file, state: "fail", stage, message, expected, actual } or { file, state: "skip", message }).
// One such line a file, when every way to build it is through. `ways` says how each went.
//
// Every build and every run has a time limit. What passes it is ended with everything it started, and the program fails alone.
// What a signal ends is judged at once, by that signal: nothing writes a core dump, and nothing that it leaves behind is waited for.
// All that runs at once shares the memory that the machine has: where that runs short, what holds most is ended, and its program fails alone.
// An executable is as large as Bun. What is built is run before more is built, and an executable goes when its program is judged.
// However the driver ends, nothing that it started runs on and its temporary folder is gone.
// Its last line, on stderr, says where the time went.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { measureHere, openInstructionCounter } from "./analysis-scaling/measure-here";
import { runtimeEnvironment } from "./harness/flags";
import { availableMemory, endAtMemoryLimitTogether } from "./harness/memory-limit";
import { ways } from "./harness/ways";
import { withoutCoreDump } from "./harness/without-core-dump";
import "./harness/without-installing-packages";

/** `overLimit`: why the driver ended it. */
type Output = { exitCode: number | null; signal: string | null; stdout: string; stderr: string; overLimit?: string };
type Bound = { name: string; relation: string; bound: number; todo?: string };
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
  printsWhatIsSaved: boolean;
  runsByItself: boolean;
  weight: number;
  namesModules: boolean;
  asksForEntryPoint: boolean;
  exitCode: number;
  todo?: string;
  skip?: string;
  todoOfBuildWith: (flags: readonly string[]) => string | undefined;
  marksNotRead: string[];
  /** The flags of each further build that it asks for. */
  under: string[][];
  statistics: Bound[];
  counts: Bound[];
  boundsNotRead: string[];
  /** What `// Sizes:` and `// Passes:` say. */
  growth?: { sizes: number[]; passes: number; of: "the run" | "the build"; power: number; roomOfPeakMB?: number };
  growthNotRead?: string;
  output?: string;
  buildErrors?: string;
  way: "compiled" | `under ${string}`;
  /** Of a build behind the first: why it does not pass today. */
  todoOfWay?: string;
};

// A weight of one is what the build of a small program takes.
const msOfWeight = 300;
// Whoever names one of these, in whichever of its files, brings thousands of functions of Bun's library, and takes as long to build as eight other programs.
const namesMuchOfTheLibrary =
  /["'`](?:node:)?(?:assert|child_process|cluster|console|crypto|dgram|diagnostics_channel|dns|events|fs|https?|http2|inspector|net|perf_hooks|readline|repl|stream|tls|tty|util|v8|worker_threads|zlib)(?:\/[a-z]+)?["'`]|\bWorker\b|\bprocess\.std(?:in|out|err)\b/;
// So does whoever lets one of these stand as a value: all that hangs on it is out of the compiler's sight.
const handsOutObjectOfHost = /(?<![.\w$"'`:])(?:globalThis|process|Bun)\b(?!\s*\??\.\s*[A-Za-z_$])(?!["'`:])/;
// Whoever names one of these, in whichever of its files, gets another answer behind another entry point.
const asksForEntryPoint = /\bmainModule\b|\brequire\s*\.\s*main\b|\bmeta\s*\.\s*main\b|\bmodule\s*\.\s*parent\b/;
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
// What a program took in CI, in milliseconds: its build and its runs. One that takes under a second has no entry.
const tookInCI: Record<string, { default?: number } | undefined> = (() => {
  try {
    return JSON.parse(readFileSync(join(import.meta.dir, "..", "expected-durations.json"), "utf8"));
  } catch {
    return {};
  }
})();
/** In milliseconds. */
const expectedTimeOf = (program: Program) =>
  tookInCI[relative(join(import.meta.dir, ".."), program.path).replaceAll("\\", "/")]?.default ?? 800 * program.weight;
const longestTextShown = 16 * 1024;

const option = (name: string) =>
  process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(option("root") ?? join(import.meta.dir, "parallel"));
const listed = option("files-from");
const files = listed
  ? readFileSync(listed, "utf8").split(/\r?\n/).filter(Boolean)
  : process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const jobs = Number(option("jobs")) || availableParallelism();
const takesTheFirstBuildAlone = process.argv.includes("--no-erased");
const moreFlags = option("more-flags")?.split(/\s+/).filter(Boolean) ?? [];
const envOfEveryExecutable = Object.fromEntries(
  (option("env-of-the-executable")?.split(/\s+/).filter(Boolean) ?? []).map(word => word.split(/=(.*)/s).slice(0, 2)),
);
const runsAreAsUsersRunThem = !Object.keys(envOfEveryExecutable).length;
const countsInstructions = process.argv.includes("--instructions");
const keepsStatistics = process.argv.includes("--keep-statistics");
const statisticsKept = new Map<string, Record<string, number>>();
/** Of each bound that says ` Todo:` here and was asked: what was counted. */
const countedForGoalsNotMet = new Map<string, Record<string, number>>();
const goalsNotMetOf = (file: string) =>
  countedForGoalsNotMet.has(file) ? { goalsNotMet: countedForGoalsNotMet.get(file) } : {};
if (countsInstructions && !Bun.which("perf")) throw new Error("--instructions: there is no `perf` here");
let opensCounter: boolean | undefined;
/** Asked by the first program that needs it: where no counter opens, a line on stderr says why. */
function opensCounterOfItsOwn() {
  if (opensCounter === undefined) {
    const close = process.platform === "linux" ? openInstructionCounter(0) : undefined;
    close?.();
    opensCounter = !!close;
  }
  return opensCounter;
}
const isASAN = (() => {
  try {
    return require("bun:internal-for-testing").isASANEnabled() as boolean;
  } catch {
    return basename(process.execPath).includes("asan");
  }
})();
const askedOfAll = option("under")?.split(/\s+/).filter(Boolean);
const isCheck = (flag: string) => flag.startsWith("--aot-check=");
const oneGuessIn = option("one-guess-in") ?? String([3, 2, 7][Number(process.env.BUILDKITE_BUILD_NUMBER ?? 0) % 3]);
if (!/^(?:[2-9]|[1-9]\d+)(?::\d+)?$/.test(oneGuessIn)) throw new Error(`--one-guess-in=${oneGuessIn}: <n> or <n>:<seed>, and n over 1`);
const whereGuessesFail = [`--aot-testing=FailGuesses:${oneGuessIn}`];
const waysBehindTheFirst = ways.map(({ flags }) => flags).filter(flags => flags.length > 0);
const isOneOfTheWays = (flags: readonly string[]) => waysBehindTheFirst.some(way => way.join(" ") === flags.join(" "));
/** The flags of each build of a program behind the first. */
function furtherBuilds({ under, flags: own, buildErrors }: Program) {
  if (takesTheFirstBuildAlone || moreFlags.length || buildErrors !== undefined) return [];
  const asked: (readonly string[])[] = askedOfAll
    ? [askedOfAll]
    : [...waysBehindTheFirst, whereGuessesFail, ...under.filter(flags => !isOneOfTheWays(flags))];
  const seen = new Set<string>();
  return asked.filter(flags => {
    const key = flags.join(" ");
    if (seen.has(key) || flags.every(flag => own.includes(flag))) return false;
    seen.add(key);
    return true;
  });
}
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
  // For the builds. No user sets it, so what is RUN runs without it, the executable and plain Bun alike (`envOfRuns`): the reference is `bun <file>` as users run it.
  // On one thread plain Bun reads the texts in the order in which they are asked for, which hid what a ring of modules does at default flags.
  BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1",
  // A Bun ends with the process that started it, and takes along what it started itself.
  BUN_FEATURE_FLAG_NO_ORPHANS: "1",
  // A Bun that a signal ends starts a command that sends a report. It goes where scripts/runner.node.ts says, or nowhere.
  ...(!inherited.BUN_CRASH_REPORT_URL && { BUN_ENABLE_CRASH_REPORTING: "0" }),
  ...(isASAN && {
    // The slow unwinder aborts in a frame of compiled code and cuts the report off.
    ASAN_OPTIONS:
      (inherited.ASAN_OPTIONS ?? "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=0") +
      ":fast_unwind_on_fatal=1",
  }),
};
// A build is a user's build: with the two variables that Bun's tests run under it would find the modules of Bun's own tests.
const { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: __, BUN_GARBAGE_COLLECTOR_LEVEL: ___, ...environmentOfUser } = environment;
// But for where it goes: the build writes the program alone, a file that starts as the executable would, and not a copy of Bun with the program behind it.
// `// Env of the build: BUN_AOT_WRITES_PROGRAM_ALONE=0` is for a program that asks about the file, AOT_REAL_EXECUTABLES=1 around the driver for all of them.
// On Linux alone: nothing starts such a file on Windows, and nobody has seen one start on macOS.
const environmentOfBuilds = {
  ...environmentOfUser,
  ...(process.platform === "linux" &&
    !process.env.AOT_REAL_EXECUTABLES && { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1", BUN_AOT_WRITES_PROGRAM_ALONE: "1" }),
};
let hasFailed = false;

let free = jobs;
const waiting: (() => void)[] = [];
const waitingBuilds: { weight: number; start: (slots: number) => void }[] = [];
/** The longest first: what is left for the end is short. */
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
/** In seconds, for a run or a build of weight one, and for each further unit of weight. Several times what a busy machine takes. */
const timeLimit = (cmd: string[], weight = 1) =>
  ((cmd[1] !== "build" && Number(option("seconds"))) || (isASAN || cmd.some(isCheck) ? 240 : 90)) +
  (isASAN ? 30 : 15) * (weight - 1);
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
// Whoever reads these lines ends a driver that says nothing for minutes. A build may take that long.
setInterval(() => {
  if (lastTaken && running.size && performance.now() - saidAt > 60_000) say(lastTaken);
}, 10_000).unref();

const processes = Object.fromEntries(
  ["builds", "executables", "references"].map(kind => [kind, { count: 0, ms: 0, cpuMs: 0, longestMs: 0, longest: "" }]),
);
let lastToEnd = "";
function noteProcess(cmd: string[], cwd: string, ms: number, cpuMs: number) {
  const isBuild = cmd[1] === "build";
  const isReference = cmd[0] === process.execPath;
  const entryPoint = cmd.find(word => /^\.\.?\//.test(word) || word.startsWith(root));
  // An executable has the name of its program, and runs in the folder of the program.
  const what = relative(
    root,
    isBuild ? resolve(cwd, entryPoint ?? ".") : isReference ? cmd[1] : join(cwd, basename(cmd[0])),
  );
  const kind = processes[isBuild ? "builds" : isReference ? "references" : "executables"];
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
    noteProcess(cmd, cwd, ms, Number(child.resourceUsage()?.cpuTime.total ?? 0) / 1000);
    const userMs = Number(child.resourceUsage()?.cpuTime.user ?? 0) / 1000;
    // Nothing is held on Windows, where the watcher tells nothing either.
    const mostResidentMB = isWindows ? 0 : Math.round(Number(child.resourceUsage()?.maxRSS ?? 0) / 2 ** 20);
    return { output, ms, userMs, peakMB: Math.round(held.peak / 2 ** 20), mostResidentMB };
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
/** `    at name (file:3:14)`, `    at /folder/file.js:3:14`, `    at map (native)`. A line that only begins with `at` is a line of the program. */
const isFrame = (line: string) =>
  /^\s+at (?:.+ )?\((?:[^()]*:\d+(?::\d+)?|native|unknown|\[native code\])\)$|^\s+at [^\s()]*[\/\\.][^\s()]*:\d+(?::\d+)?$|^\s+at <anonymous>$/.test(
    line,
  );
/**
 * Without the lines that are frames, the lines of the source that are quoted above an error down to the caret below them, and the place behind the name of a file: `/folder/main.js:3:14` is `main.js`.
 * NOTHING ELSE: `3:14`, `sum:42`, `{a:1}`, `  at 12:30 it rang` and `1 | 2` are answers of a program.
 */
function withoutFrames(text: string) {
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    if (isFrame(line)) continue;
    if (/^\s*\^+\s*$/.test(line)) {
      while (kept.length && /^\s*\d+ \| /.test(kept.at(-1)!)) kept.pop();
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n").replace(/(?:[^\s'":()]*[\/\\])?([^\s'":()\/\\]+\.[cm]?[jt]sx?)(?::\d+)+/g, "$1");
}
const agreeButForFrames = (one: ReturnType<typeof comparedWithPlain>, other: ReturnType<typeof comparedWithPlain>) =>
  Bun.deepEquals(
    { ...one, stdout: withoutFrames(one.stdout), stderr: withoutFrames(one.stderr) },
    { ...other, stdout: withoutFrames(other.stdout), stderr: withoutFrames(other.stderr) },
  );
/** A module that runs the program where every stack trace has the same ten frames. */
const behindTheSameFrames = (path: string) =>
  [
    `const frames = "\\n    at frame (file:1:1)".repeat(10);`,
    `Error.prepareStackTrace = error => {`,
    `  try {`,
    `    return String(error) + frames;`,
    `  } catch {`,
    `    return "Error" + frames;`,
    `  }`,
    `};`,
    `await import(${JSON.stringify(path)});`,
    ``,
  ].join("\n");
/** Each line in which `one` and `other` differ is another line in the run of the same side where the frames are others. */
function differOnlyInLinesWithFrames(one: string, other: string, oneAgain: string, otherAgain: string) {
  const [lines, others, again, othersAgain] = [one, other, oneAgain, otherAgain].map(text => withoutFrames(text).split("\n"));
  if (lines.length !== others.length || lines.length !== again.length || lines.length !== othersAgain.length) return false;
  return lines.every((line, at) => line === others[at] || (line !== again[at] && others[at] !== othersAgain[at]));
}
let programsWhoseFramesDiffer = 0;
const programsWhoseReferenceWavered = new Set<string>();
let programsMarkedForFramesAlone = 0;
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

const withoutLinesOfImage = (stderr: string) => stderr.replace(/^\[aot\] .*\r?\n/gm, "");

/** What no mark stands for. A `Todo` says that a program answers otherwise than its reference, or that its build refuses it: not that something dies. */
const deathOf = ({ signal, overLimit, stderr }: Output) =>
  signal ??
  overLimit ??
  /^.*(?:internal compiler error \(|ERROR: AddressSanitizer|ASSERTION FAILED|panicked at ).*$/m.exec(stderr)?.[0];

/** What a `// Todo` of a program, or of one of its builds, stands for: the stage at which it fails today and, where that is what it prints, the two words of which one is printed for the other. */
type Mark = { stage: "growth" | "compare"; alike?: readonly [string, string] };
function readMark(said: string): Mark | undefined {
  if (said.startsWith("it grows: ")) return { stage: "growth" };
  if (said.startsWith("only frames")) return { stage: "compare" };
  const [, one, other] = /^"([^"]+)" \| "([^"]+)": ./.exec(said) ?? [];
  return one === undefined ? undefined : { stage: "compare", alike: [one, other] };
}
/** Whether the two print the same once nobody tells the one word from the other. */
type AlikeBut = (one: string, other: string) => boolean;
function standsFor(said: string, { stage, alikeBut }: Record<string, unknown>) {
  const mark = readMark(said);
  return mark?.stage === stage && (!mark.alike || (alikeBut as AlikeBut | undefined)?.(...mark.alike) === true);
}
const notWhatItsMarkStandsFor = (verdict: Record<string, unknown>) =>
  verdict.stage === "read"
    ? verdict
    : { ...verdict, message: `${verdict.message}: its \`// Todo\` does not stand for that` };

const waysLeft = new Map<string, number>();
const verdicts = new Map<string, Record<string, unknown>[]>();
/** A file has one verdict: of the ways that fail the first build, or else whichever failed first; or else the first. */
function settle(program: Program, verdict: Record<string, unknown>) {
  if (program.todoOfWay !== undefined && !verdict.died)
    verdict =
      verdict.state === "fail"
        ? standsFor(program.todoOfWay, verdict)
          ? { state: "todo" }
          : notWhatItsMarkStandsFor(verdict)
        : {
            state: "fail",
            stage: "todo",
            message: `${program.way}: it passes: its \`// Todo under ..:\` line goes out`,
          };
  const all = [...(verdicts.get(program.file) ?? []), { file: program.file, way: program.way, ...verdict }];
  verdicts.set(program.file, all);
  if (all.length < waysLeft.get(program.file)!) return;
  const sum = (name: string) => all.reduce((total, verdict) => total + Number(verdict[name] ?? 0), 0);
  const failed = all.some(({ state }) => state === "fail");
  if (program.skip !== undefined && !all.some(({ died }) => died)) {
    const differs = all.find(({ state }) => state === "fail");
    const linesOf = (output: unknown) => JSON.stringify((output as Output | undefined)?.stdout ?? "");
    const printed = differs
      ? `the reference printed ${linesOf(differs.expected)} and the executable ${linesOf(differs.actual)}`
      : "the executable printed what the reference printed";
    return say({
      file: program.file,
      state: "skip",
      message: `skipped on this platform: ${program.skip} | in this run ${printed}`,
      ...goalsNotMetOf(program.file),
    });
  }
  const failsOtherwise =
    program.todo !== undefined && all.find(verdict => verdict.state === "fail" && !standsFor(program.todo!, verdict));
  if (failsOtherwise && !all.some(({ died }) => died)) {
    hasFailed = true;
    return say({ ...notWhatItsMarkStandsFor(failsOtherwise), ...goalsNotMetOf(program.file) });
  }
  if (program.todo !== undefined && !all.some(({ died }) => died)) {
    // Whichever way ends last settles the file, and only the first build says how it grows.
    const growth = asWritten.find(({ file }) => file === program.file)?.growth;
    // Of how a build grows only the peak is judged where nothing is counted: a mark may stand for the instructions, and a run that has not counted them has not seen it met.
    const isHalfJudged = growth?.of === "the build" && !countsInstructions && !opensCounterOfItsOwn();
    if (failed || moreFlags.length || !runsAreAsUsersRunThem || (isASAN && growth) || isHalfJudged) {
      if (program.todo.startsWith("only frames")) programsMarkedForFramesAlone++;
      return say({ file: program.file, state: "skip", message: `todo: ${program.todo}`, ...goalsNotMetOf(program.file) });
    }
    hasFailed = true;
    return say({
      file: program.file,
      state: "fail",
      stage: "todo",
      message: "it passes: its `// Todo:` line goes out",
      ...goalsNotMetOf(program.file),
    });
  }
  hasFailed ||= failed;
  say({
    ...(all.find(({ died }) => died) ??
      all.find(({ state, way }) => state === "fail" && way === "compiled") ??
      all.find(({ state }) => state === "fail") ?? {
        ...all.find(({ state }) => state !== "todo"),
        compileMs: sum("compileMs"),
        runMs: sum("runMs"),
        plainMs: sum("plainMs"),
      }),
    ways: Object.fromEntries(
      all.map(({ way, state, isCompared }) => [way, isCompared === false ? "built and run, not compared" : state]),
    ),
    ...(all.some(({ referenceWavered }) => referenceWavered) && { referenceWavered: true }),
    ...(statisticsKept.has(program.file) && { statistics: statisticsKept.get(program.file) }),
    ...goalsNotMetOf(program.file),
  });
}
// A long output is cut where it is shown, and the cut must not hide the difference.
const leavingOutTheSame = (output: Output, other: Output) => ({
  ...output,
  stdout: differingLines(output.stdout, other.stdout),
  stderr: differingLines(output.stderr, other.stderr),
});
function fail(
  program: Program,
  stage: string,
  message: string,
  actual?: Output,
  expected?: Output,
  alikeBut?: AlikeBut,
) {
  settle(program, {
    state: "fail",
    stage,
    message: program.way === "compiled" ? message : `${program.way}: ${message}`,
    died: actual && deathOf(actual),
    alikeBut,
    expected: expected && shown(actual ? leavingOutTheSame(expected, actual) : expected),
    actual: actual && shown(expected ? leavingOutTheSame(actual, expected) : actual),
  });
}

/** Only a COUNT names what is counted with its kind in front. */
function readBound(line: string): (Bound & { kind: string }) | undefined {
  const [, kind, name, relation, bound, platform, arch, todo] =
    /^\/\/ (STATISTIC|COUNT|COUNTER): ([\w:]+) (=|>=|<=) (\d+)(?: Todo(?: on (\w+)(?: (\w+))?)?: (.+))?$/.exec(line) ?? [];
  if (kind === undefined || (kind !== "COUNT" && name.includes(":"))) return undefined;
  const isTodoHere =
    (platform === undefined || platform === process.platform) && (arch === undefined || arch === process.arch);
  return { kind, name, relation, bound: Number(bound), todo: isTodoHere ? todo : undefined };
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
  const namesModules = someFileOf(path, text => namesMuchOfTheLibrary.test(text));
  const saidOfGrowth = [lines("Sizes"), lines("Passes"), lines("Grows")];
  const sizes = (saidOfGrowth[0][0] ?? "").split(/\s+/).map(Number);
  const passes = Number(saidOfGrowth[1][0]);
  const growsWithProgram = saidOfGrowth[2][0]?.startsWith("the build, ") ?? false;
  const growthIsRead =
    saidOfGrowth.every(said => said.length === 1) &&
    sizes.length === 3 &&
    sizes.every(
      (size, index) =>
        Number.isSafeInteger(size) &&
        size > 0 &&
        (index === 0 || (growsWithProgram ? size > sizes[index - 1] : size === 4 * sizes[index - 1])),
    ) &&
    Number.isSafeInteger(passes) &&
    passes > 0 &&
    ["linear", "the build, linear", "the build, a square"].includes(saidOfGrowth[2][0]);
  return {
    file,
    path,
    flags,
    env: Object.fromEntries(lines("Env").map(line => line.split(/=(.*)/s).slice(0, 2))),
    envOfExecutable: {
      ...envOfEveryExecutable,
      ...Object.fromEntries(lines("Env of the executable").map(line => line.split(/=(.*)/s).slice(0, 2))),
    },
    envOfBuild: Object.fromEntries(lines("Env of the build").map(line => line.split(/=(.*)/s).slice(0, 2))),
    buildPrints: lines("Build prints").map(line => {
      const [, times, text] = /^(\d+) x (.*)$/.exec(line)!;
      return { times: Number(times), line: text };
    }),
    entryPoints: words("Entry points"),
    comparesWithCompiled: lines("Reference").includes("bun build --compile"),
    printsWhatIsSaved: lines("Prints what the compiler saves").length + lines("Prints what goes by the copy that runs").length > 0,
    runsByItself: lines("Runs by itself").length > 0,
    weight: tookMs.has(path)
      ? Math.max(8, Math.round(tookMs.get(path)! / msOfWeight))
      : namesModules || someFileOf(path, text => handsOutObjectOfHost.test(text))
        ? 8
        : 1,
    namesModules,
    asksForEntryPoint: texts.some(text => asksForEntryPoint.test(text)),
    exitCode: Number(lines("Exit code")[0] ?? 0),
    todo:
      (isASAN ? lines("Todo under ASAN")[0] : undefined) ??
      lines(`Todo on ${process.platform} ${process.arch}`)[0] ??
      lines("Todo")[0],
    skip: (isASAN ? lines("Skip under ASAN")[0] : undefined) ?? lines(`Skip on ${process.platform} ${process.arch}`)[0],
    marksNotRead: Array.from(
      head.matchAll(/^\/\/ Todo(?: on \w+ \w+| under ASAN| under a check)?:[ \t]+(.*)$/gm),
      ([line, said]) => (readMark(said.trim()) ? [] : [line]),
    ).flat(),
    todoOfBuildWith: flags =>
      lines(`Todo under ${flags.join(" ")}`)[0] ?? (flags.some(isCheck) ? lines("Todo under a check")[0] : undefined),
    under: lines("Under").map(line => line.split(": ", 1)[0].split(/\s+/).filter(Boolean)),
    statistics: bounds.filter(({ kind }) => kind === "STATISTIC"),
    counts: bounds.filter(({ kind }) => kind !== "STATISTIC"),
    boundsNotRead: boundLines.filter(line => !readBound(line)),
    growth: growthIsRead
      ? {
          sizes,
          passes,
          of: growsWithProgram ? "the build" : "the run",
          power: saidOfGrowth[2][0].endsWith("a square") ? 2 : 1,
          roomOfPeakMB: Number.parseInt(lines("Room of the peak")[0] ?? "") || undefined,
        }
      : undefined,
    growthNotRead:
      growthIsRead || saidOfGrowth.every(said => said.length === 0)
        ? undefined
        : "not of the form `// Sizes: <n> <4n> <16n>`, `// Passes: <n>`, `// Grows: linear`, each once" +
          ", or three rising sizes and `// Grows: the build, linear` or `the build, a square`",
    output: last("Output"),
    buildErrors: last("Build errors"),
    way: "compiled",
  };
}

/** The first error of its build that points into the program. */
function findErrorInProgram(stderr: string, { path }: Program) {
  const builtIn = dirname(path);
  let error: string | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    if (/^error\b/.test(line)) error = line;
    const [, file] = /^\s+at (.+):\d+:\d+$/.exec(line) ?? [];
    if (!file || error === undefined) continue;
    const named = resolve(builtIn, file);
    if (named === path || (/[\\/]main\.[a-z]+$/.test(path) && named.startsWith(builtIn + sep))) return error;
    error = undefined;
  }
  return undefined;
}

let executables = 0;
const nextExecutable = (name: string) =>
  join(folder, `${name}-${executables++}${process.platform === "win32" ? ".exe" : ""}`);

/**
 * The files of an executable as they are named elsewhere than on Windows: /$bunfs for B:\~BUN and B:/~BUN, and / for B:/, which lies above it.
 * What is stored, in the comment Output and in what a build is to print, names them so.
 */
const asNamedElsewhere = (text: string) =>
  isWindows
    ? text
        .replace(/B:[\\/]~BUN(?=[\\/])[^\s'":]*/g, path => "/$bunfs" + path.slice(7).replaceAll("\\", "/"))
        .replace(/(?<!\w)B:\/(?=[^\s'":])/g, "/")
    : text;

/**
 * As it stands in the comment Output.
 * What an option of the engine logs goes through the C library, which on Windows ends a line with a carriage return and a line feed.
 */
const asText = ({ exitCode, stdout, stderr }: ReturnType<typeof compared>) =>
  asNamedElsewhere(stdout + (exitCode ? `exit code ${exitCode}\n${stderr}\n` : stderr.replaceAll("\r\n", "\n")));

const countedByBuild = (buildOutput: string) =>
  new Map(Array.from(buildOutput.matchAll(/^(\w+) (\d+)$/gm), ([, name, value]) => [name, Number(value)] as const));

/**
 * What the files that BUN_JSC_aotCountsPath names hold: each line under its name and under its name without its kind, and all calls into the run time together.
 * An operation that nothing called has a line too, so a name without one is a name that nothing counts.
 */
function countedByRun(text: string) {
  const counted = new Map([["operations", 0]]);
  const add = (name: string, count: number) => counted.set(name, (counted.get(name) ?? 0) + count);
  for (const line of text.split("\n")) {
    const [count, name] = line.split("\t");
    if (name === undefined) continue;
    add(name, Number(count));
    add(name.slice(name.indexOf(":") + 1), Number(count));
    if (name.startsWith("operation:")) add("operations", Number(count));
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

function unmetBounds(file: string, counted: Map<string, number>, bounds: Bound[], who: "build" | "executable") {
  return bounds.flatMap(({ name, relation, bound, todo }) => {
    // With AddressSanitizer the allocators have shorter free lists, so compiled code calls the run time for a new one more often.
    if (isASAN && name === "operations") return [];
    const value = counted.get(name);
    if (value === undefined) return [`${name} ${relation} ${bound}, but the ${who} counted nothing of that name`];
    const isMet = relation === "=" ? value === bound : relation === ">=" ? value >= bound : value <= bound;
    if (todo !== undefined) {
      countedForGoalsNotMet.set(file, { ...countedForGoalsNotMet.get(file), [`${name} ${relation} ${bound}`]: value });
      return isMet ? [`${name} ${relation} ${bound} is met: its \`Todo:\` goes out`] : [];
    }
    return isMet ? [] : [`${name} ${relation} ${bound}, but the ${who} counted ${value}`];
  });
}

// Counted, a linear program reads 3.9 to 5.2. By the clock, on a machine with twice as much to do as it has processors, up to 6.9; a square 14 to 16 either way.
const mostThatIsLinear = countsInstructions ? 6 : 9;
// No linear program has read more than this. What reads more is measured again, and the least of three runs at each size is judged.
const mostThatIsLinearAtOnce = countsInstructions ? 6 : 6.9;
const leastMsOfSmallestRun = 50;
/**
 * How what the executable takes grows with its data. A run that does not end as the program ends fails it.
 * Other work on the machine can only make a run longer. A longer run at the middle size makes a square look linear: 54 | 429 | 3170 ms read 7.31.
 */
async function measureGrowth(
  { growth, exitCode }: Program,
  executable: string,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<{ growth: number; measured?: string; message?: string; output?: Output }> {
  const { sizes } = growth!;
  // A count has no noise to speak of, and an eighth of the work says the same.
  let passes = countsInstructions ? Math.max(1, Math.round(growth!.passes / 8)) : growth!.passes;
  const counted = `${executable}.instructions`;
  const take = async (size: number) => {
    const cmd = countsInstructions
      ? ["perf", "stat", "-x,", "-e", "instructions:u", "-o", counted, "--", executable]
      : [executable];
    const { output, userMs } = await withSlot(() =>
      start(cmd, cwd, { ...env, SIZE: String(size), PASSES: String(passes) }),
    );
    if (output.overLimit || output.signal || output.exitCode !== exitCode) return { output, taken: NaN };
    if (!countsInstructions) return { output, taken: userMs };
    const written = await Bun.file(counted)
      .text()
      .catch(() => "");
    rmSync(counted, { force: true });
    const [, instructions] = /^(\d+),,instructions/m.exec(written) ?? [];
    return { output, taken: Number(instructions) / 1e6 };
  };
  const unit = countsInstructions ? "M instructions" : "ms";
  for (let raised = 0; !countsInstructions && raised < 4; raised++) {
    const { output, taken } = await take(sizes[0]);
    if (Number.isNaN(taken))
      return { growth: NaN, message: `at the size ${sizes[0]} it ended by ${describeEnd(output)}`, output };
    if (taken >= leastMsOfSmallestRun) break;
    passes *= Math.ceil((1.2 * leastMsOfSmallestRun) / Math.max(taken, 5));
  }
  const least = sizes.map(() => Infinity);
  let grows = Infinity;
  for (let round = 0; round < 3 && !(grows <= mostThatIsLinearAtOnce); round++) {
    for (const [index, size] of sizes.entries()) {
      const { output, taken } = await take(size);
      if (Number.isNaN(taken))
        return {
          growth: NaN,
          message: `at the size ${size} it ended by ${describeEnd(output)}, or nothing was counted`,
          output,
        };
      least[index] = Math.min(least[index], taken);
    }
    grows = (least[2] - least[1]) / Math.max(least[1] - least[0], Number.MIN_VALUE);
    if (countsInstructions) break;
  }
  const rounded = Math.round(grows * 100) / 100;
  const measured = `${least.map(taken => Math.round(taken)).join(" | ")} ${unit} at the sizes ${sizes.join(" | ")}, ${passes} passes`;
  if (grows <= mostThatIsLinear) return { growth: rounded, measured };
  return {
    growth: rounded,
    message: `what it takes grows faster than its data: ${rounded}, and at most ${mostThatIsLinear} is linear (4 is, 16 is a square): ${measured}`,
  };
}

const roomOfPeakMB = 32;
const bytesOfPeakForAByteOfProgram = 200;
const mostThatGrowsAsProgram = 1.5;
const parserOfJavaScript = new Bun.Transpiler({ loader: "js" });
/** A written program is named as its text reads: a type error stops the build of TypeScript alone. */
function isJavaScript(text: string) {
  try {
    parserOfJavaScript.scan(text);
    return true;
  } catch {
    return false;
  }
}

/** How what a build takes grows with the program: the program at hand writes the programs that are built. */
async function measureGrowthOfBuild(
  { growth, path }: Program,
  executable: string,
  cwd: string,
  env: Record<string, string | undefined>,
  command: (entry: string, outfile: string) => string[],
): Promise<{ growth?: number; measured?: string; message?: string; output?: Output }> {
  const { sizes, passes, power, roomOfPeakMB: room = roomOfPeakMB } = growth!;
  const counted = `${executable}.instructions`;
  const taken: number[] = [];
  const peaks: number[] = [];
  const bytes: number[] = [];
  for (const size of sizes) {
    const written = await withSlot(() =>
      start([process.execPath, path], cwd, { ...env, SIZE: String(size), PASSES: String(passes) }),
    );
    if (written.output.overLimit || written.output.exitCode !== 0)
      return { message: `it writes no program of the size ${size}`, output: written.output };
    const entry = `${executable}-of-the-size-${size}.${isJavaScript(written.output.stdout) ? "js" : "ts"}`;
    const outfile = nextExecutable("written");
    writeFileSync(entry, written.output.stdout);
    let remove = () => {};
    try {
      const cmd = command(entry, outfile);
      const build = await withSlot(() =>
        start(
          countsInstructions ? ["perf", "stat", "-x,", "-e", "instructions:u", "-o", counted, "--", ...cmd] : cmd,
          folder,
          environmentOfBuilds,
          timeLimit(cmd, 8),
        ),
      );
      remove = noteExecutable(outfile);
      if (build.output.overLimit || build.output.exitCode !== 0)
        return {
          message: `the build of its program of the size ${size} ended with ${describeEnd(build.output)}`,
          output: build.output,
        };
      const compiled = await withSlot(() => start([outfile], folder, env));
      const plain = await withSlot(() => start([process.execPath, entry], folder, env));
      if (compiled.output.stdout !== plain.output.stdout || compiled.output.exitCode !== plain.output.exitCode)
        return { message: `its program of the size ${size} does not print as plain Bun does`, output: compiled.output };
      peaks.push(build.mostResidentMB || build.peakMB);
      bytes.push(written.output.stdout.length);
      if (!countsInstructions) {
        if (!opensCounterOfItsOwn()) continue;
        const again = await withSlot(() => measureHere(folder, cmd, timeLimit(cmd, 8) * 1000, environmentOfBuilds));
        if (again.exitCode !== 0 || again.instructions === undefined)
          return { message: "nothing was counted", output: build.output };
        taken.push(again.instructions / 1e6);
        continue;
      }
      const text = await Bun.file(counted)
        .text()
        .catch(() => "");
      rmSync(counted, { force: true });
      const [, instructions] = /^(\d+),,instructions/m.exec(text) ?? [];
      if (instructions === undefined) return { message: "nothing was counted", output: build.output };
      taken.push(Number(instructions) / 1e6);
    } finally {
      remove();
      rmSync(entry, { force: true });
    }
  }
  const said = `at the sizes ${sizes.join(" | ")}, ${passes} copies`;
  const mayHold = peaks[0] + room + (bytesOfPeakForAByteOfProgram * (bytes[2] - bytes[0])) / 2 ** 20;
  if (peaks[2] > mayHold)
    return {
      message: `what the build holds at its peak grows faster than its program: ${peaks.join(" | ")} MB ${said}, and at most ${Math.round(mayHold)} MB at the last`,
    };
  if (taken.length !== sizes.length) return {};
  const asTheSizes = (sizes[2] ** power - sizes[1] ** power) / (sizes[1] ** power - sizes[0] ** power);
  const grows = (taken[2] - taken[1]) / Math.max(taken[1] - taken[0], Number.MIN_VALUE) / asTheSizes;
  const rounded = Math.round(grows * 100) / 100;
  if (grows <= mostThatGrowsAsProgram) return { growth: rounded };
  return {
    growth: rounded,
    message:
      `what the build takes grows faster than ${power === 2 ? "the square of " : ""}its program: ${rounded} times as fast, and at most ${mostThatGrowsAsProgram}: ` +
      `${taken.map(count => Math.round(count)).join(" | ")} M instructions ${said}`,
  };
}

/** Every way to build a file is held to one run of the reference. */
const references = new Map<string, ReturnType<typeof start>>();

async function run(program: Program): Promise<void> {
  if (program.boundsNotRead.length)
    return fail(
      program,
      "read",
      `not of the form \`// STATISTIC | COUNT | COUNTER: <name> (= | >= | <=) <n>\`: ${program.boundsNotRead.join("; ")}`,
    );
  if (program.growthNotRead) return fail(program, "read", program.growthNotRead);
  if (program.marksNotRead.length)
    return fail(
      program,
      "read",
      'not of the form `// Todo..: it grows: <why>`, `// Todo..: "<a word>" | "<the word for it>": <why>` or `// Todo: only frames (..): <why>`: ' +
        program.marksNotRead.join("; "),
    );
  if ("BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER" in { ...program.env, ...program.envOfExecutable })
    return fail(program, "read", "no user sets BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: what is run runs without it");
  const cwd = dirname(program.path);
  const executable = nextExecutable(basename(program.path).replace(/\.[a-z]+$/, ""));
  const command = (threads: number, entry = "./" + basename(program.path), outfile = executable) => [
    process.execPath,
    "build",
    "--compile",
    "--aot",
    `--aot-threads=${threads}`,
    ...program.flags,
    ...(program.statistics.length || (keepsStatistics && program.way === "compiled") ? ["--explain=statistics"] : []),
    entry,
    ...program.entryPoints,
    "--outfile",
    outfile,
  ];
  const build = await withSlotsOfBuild(expectedTimeOf(program), threads => {
    say((lastTaken = { file: program.file, way: program.way, state: "compiling" }));
    const cmd = command(threads);
    return start(cmd, cwd, { ...environmentOfBuilds, ...program.envOfBuild }, timeLimit(cmd, program.weight));
  });
  const remove = noteExecutable(executable);
  try {
    if (build.output.overLimit) {
      const still = build.output.stderr.split("\n").filter(line => line.startsWith("Still "));
      return fail(
        program,
        "compile",
        [`the build ended with ${describeEnd(build.output)}`, ...still].join("\n  "),
        build.output,
      );
    }
    if (program.buildErrors !== undefined) {
      // Each distinct error counts once. A Bun built with assertions names the token behind some of the messages of the parser.
      const lines = build.output.stderr.split(/\r?\n/).filter(line => line.startsWith("error: "));
      const errors =
        [...new Set(lines.map(line => asNamedElsewhere(line.replace(/ \(token: T\w+\)$/, ""))))].join("\n") + "\n";
      if (errors === program.buildErrors && build.output.exitCode === 1)
        return settle(program, { state: "pass", compileMs: build.ms });
      return fail(
        program,
        "compile",
        "the build does not end with exit code 1 and the errors that the program lists",
        build.output,
      );
    }
    if (build.output.exitCode !== 0 || /^error\b/m.test(build.output.stderr))
      return fail(
        program,
        "compile",
        findErrorInProgram(build.output.stderr, program) ?? `the build ended with ${describeEnd(build.output)}`,
        build.output,
      );
    if (keepsStatistics && program.way === "compiled")
      statisticsKept.set(
        program.file,
        Object.fromEntries([...countedByBuild(build.output.stderr)].filter(([, count]) => count)),
      );
    const unmet =
      program.way === "compiled" && !moreFlags.length
        ? unmetBounds(program.file, countedByBuild(build.output.stderr), program.statistics, "build")
        : [];
    const printed = build.output.stderr.split(/\r?\n/).map(asNamedElsewhere);
    for (const { times, line } of moreFlags.length ? [] : program.buildPrints) {
      const found = printed.filter(text => text === line).length;
      if (found !== times) unmet.push(`the build prints ${found} x ${line}, not ${times} x`);
    }
    if (unmet.length) return fail(program, "compile", unmet.join("; "), build.output);
    const env = { ...environment, ...program.env };
    const { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: _, ...envOfRuns } = env;
    const stored = program.output;
    const withSlotOfRun = program.runsByItself ? withEverySlot : withSlot;
    const runReference = async (entry = program.path) => {
      if (!program.comparesWithCompiled) return withSlotOfRun(() => start([process.execPath, entry], cwd, envOfRuns));
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
              entry,
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
        return await withSlotOfRun(() => start([other], cwd, envOfRuns));
      } finally {
        remove();
      }
    };
    const reference = () => {
      if (stored !== undefined) return undefined;
      const known = references.get(program.path);
      if (known) return known.then(({ output, peakMB, mostResidentMB }) => ({ output, ms: 0, peakMB, mostResidentMB }));
      const first = runReference();
      references.set(program.path, first);
      return first;
    };
    // One behind the other: what holds much in one holds much in the other.
    // A file for each process: the program may start itself again.
    const counts =
      program.way === "compiled" && program.counts.length && !moreFlags.length && runsAreAsUsersRunThem
        ? `${basename(executable)}.counts-`
        : undefined;
    const compiled = await withSlotOfRun(() =>
      start([executable], cwd, {
        ...envOfRuns,
        ...(counts && { ...withoutCollections, [runtimeEnvironment.countsPath]: join(folder, `${counts}%p`) }),
        ...program.envOfExecutable,
      }),
    );
    if (compiled.output.overLimit)
      return fail(program, "run", `it ended by ${describeEnd(compiled.output)}`, compiled.output);
    const written = counts ? readdirSync(folder).filter(name => name.startsWith(counts)) : [];
    const counted = countedByRun(written.map(name => readFileSync(join(folder, name), "utf8")).join(""));
    for (const name of written) rmSync(join(folder, name), { force: true });
    const plain = await reference();
    if (compiled.output.signal)
      return fail(program, "run", `it ended by ${describeEnd(compiled.output)}`, compiled.output, plain?.output);
    // The executable ran compiled code and did not fall back to the source it holds.
    if (!compiled.output.stderr.includes("[aot] module: "))
      return fail(program, "run", "it did not run compiled code", compiled.output, plain?.output);
    compiled.output.stderr = withoutLinesOfImage(compiled.output.stderr);
    // What compiled code lays in store ahead of a deed shows in nothing that a program prints. Of 8,046 programs the worst held 1.48 times what plain Bun held.
    // Not where a program grows its data on purpose, where collections are off for a count, or under a sanitizer.
    const [mostOfCompiled, mostOfPlain] = [compiled.mostResidentMB, plain?.mostResidentMB ?? 0];
    if (
      !isASAN &&
      !moreFlags.length &&
      runsAreAsUsersRunThem &&
      !program.growth &&
      !counts &&
      mostOfPlain &&
      mostOfCompiled > 2 * mostOfPlain + 64
    )
      return fail(
        program,
        "memory",
        `it held ${mostOfCompiled} MB at most, and plain Bun ${mostOfPlain} MB`,
        compiled.output,
        plain?.output,
      );
    const unmetByRun = counts ? unmetBounds(program.file, counted, program.counts, "executable") : [];
    if (unmetByRun.length) return fail(program, "count", unmetByRun.join("; "), compiled.output, plain?.output);
    const grown =
      program.way === "compiled" && program.growth && !moreFlags.length && runsAreAsUsersRunThem && !isASAN
        ? program.growth.of === "the build"
          ? await measureGrowthOfBuild(program, executable, cwd, envOfRuns, (entry, outfile) =>
              command(1, entry, outfile),
            )
          : await measureGrowth(program, executable, cwd, { ...envOfRuns, ...program.envOfExecutable })
        : undefined;
    if (grown?.message) return fail(program, "growth", grown.message, grown.output ?? compiled.output);
    const passes = {
      state: "pass",
      ...(grown && { growth: grown.growth, measured: grown.measured }),
      compileMs: build.ms,
      runMs: compiled.ms,
      buildMB: build.peakMB,
      runMB: compiled.peakMB,
      plainMB: plain?.peakMB,
    };
    if ((moreFlags.length || !runsAreAsUsersRunThem || program.way !== "compiled") && program.printsWhatIsSaved)
      return settle(program, { ...passes, isCompared: false });
    const passesButForFrames = () => (programsWhoseFramesDiffer++, settle(program, { ...passes, framesDiffer: true }));
    if (stored !== undefined) {
      if (asText(compared(compiled.output)) === stored) return settle(program, passes);
      if (withoutFrames(asText(compared(compiled.output))) === withoutFrames(stored)) return passesButForFrames();
      return fail(
        program,
        "compare",
        "it does not print what its last comment says",
        compiled.output,
        { exitCode: null, signal: null, stdout: stored, stderr: "" },
        (one, other) => asText(compared(compiled.output)).replaceAll(one, other) === stored.replaceAll(one, other),
      );
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
      return settle(program, { ...passes, plainMs: plain!.ms });
    if (agreeButForFrames(comparedWithPlain(compiled.output), comparedWithPlain(plain!.output))) return passesButForFrames();
    if (program.todo === undefined && program.todoOfWay === undefined && program.skip === undefined)
      for (let asked = 0; asked < 2; asked++) {
        const again = await runReference();
        if (!Bun.deepEquals(comparedWithPlain(compiled.output), comparedWithPlain(again.output))) continue;
        references.set(program.path, Promise.resolve(again));
        programsWhoseReferenceWavered.add(program.file);
        console.error(
          `THE REFERENCE WAVERED: ${program.file}: plain Bun printed ${JSON.stringify(differingLines(plain!.output.stdout, again.output.stdout))} at first, ` +
            `and asked again what the executable printed: ${JSON.stringify(differingLines(again.output.stdout, plain!.output.stdout))}`,
        );
        return settle(program, { ...passes, plainMs: plain!.ms + again.ms, referenceWavered: true });
      }
    const differs = () =>
      fail(
        program,
        "compare",
        "it does not exit and print as plain Bun does",
        compiled.output,
        plain!.output,
        (one, other) => {
          const [mine, its] = [compiled, plain!].map(({ output }) => comparedWithPlain(output));
          return Bun.deepEquals(
            { ...mine, stdout: mine.stdout.replaceAll(one, other) },
            { ...its, stdout: its.stdout.replaceAll(one, other) },
          );
        },
      );
    if (program.asksForEntryPoint) return differs();
    const entry = `${executable}-behind-the-same-frames.mjs`;
    const other = nextExecutable("behind-the-same-frames");
    writeFileSync(entry, behindTheSameFrames(program.path));
    let removeOther = () => {};
    try {
      const rebuilt = await withSlotsOfBuild(expectedTimeOf(program), threads => {
        const cmd = command(threads, entry, other);
        return start(cmd, cwd, { ...environmentOfBuilds, ...program.envOfBuild }, timeLimit(cmd, program.weight));
      });
      removeOther = noteExecutable(other);
      if (rebuilt.output.overLimit || rebuilt.output.exitCode !== 0) return differs();
      const compiledAgain = await withSlotOfRun(() => start([other], cwd, { ...envOfRuns, ...program.envOfExecutable }));
      const plainAgain = await runReference(entry);
      compiledAgain.output.stderr = withoutLinesOfImage(compiledAgain.output.stderr);
      if (compiledAgain.output.overLimit || compiledAgain.output.signal || plainAgain.output.overLimit) return differs();
      const [first, reference, second, referenceAgain] = [compiled, plain!, compiledAgain, plainAgain].map(run => comparedWithPlain(run.output));
      if ([first, second, referenceAgain].some(({ exitCode }) => exitCode !== reference.exitCode)) return differs();
      if (
        agreeButForFrames(second, referenceAgain) &&
        differOnlyInLinesWithFrames(first.stdout, reference.stdout, second.stdout, referenceAgain.stdout) &&
        differOnlyInLinesWithFrames(first.stderr, reference.stderr, second.stderr, referenceAgain.stderr)
      )
        return passesButForFrames();
      differs();
    } finally {
      removeOther();
      rmSync(entry, { force: true });
    }
  } finally {
    remove();
  }
}

const refusal = /^error: --aot ((?:only supports|isn't available) .*)$/m.exec(
  Bun.spawnSync([process.execPath, "build", "--compile", "--aot", "./no-such-file.ts"], {
    cwd: root,
    timeout: timeLimit([]) * 1000,
    killSignal: "SIGKILL",
  }).stderr.toString(),
)?.[1];
// Whoever deals asks what belongs together. What a Bun cannot build is said where the programs are run.
const deals = process.argv.includes("--deal");
if (refusal && !deals) {
  for (const file of files) say({ file, state: "skip", message: `--aot ${refusal}` });
  console.error(`SKIPPED all ${files.length} programs: --aot ${refusal}`);
  process.exit(0);
}

const asWritten = files.map(read);
const all = [
  ...asWritten,
  ...asWritten.flatMap(program =>
    furtherBuilds(program).map(flags => {
      const way = `under ${flags.join(" ")}` as const;
      return {
        ...program,
        way,
        todoOfWay: program.todoOfBuildWith(flags),
        marksNotRead: [program.todoOfBuildWith(flags) ?? []].flat().filter(said => !readMark(said)),
        flags: [...program.flags, ...flags.filter(flag => !program.flags.includes(flag))],
        statistics: [],
        counts: [],
        boundsNotRead: [],
        growth: undefined,
        growthNotRead: undefined,
        buildPrints: [],
      };
    }),
  ),
];
for (const { file } of all) waysLeft.set(file, (waysLeft.get(file) ?? 0) + 1);
all.sort((one, other) => expectedTimeOf(other) - expectedTimeOf(one));
expectedTimeOfAll = all.reduce((sum, program) => sum + expectedTimeOf(program), 0);
if (deals) {
  // A build with a check takes about twice as long as one without.
  const buildsOf = (program: Program) =>
    furtherBuilds(program).reduce((builds, flags) => builds + (flags.some(isCheck) ? 2 : 1), 1);
  for (const program of all)
    if (program.way === "compiled")
      console.log(JSON.stringify({ ms: program.weight * buildsOf(program) * msOfWeight, files: [program.file] }));
  process.exit(0);
}
const runs = all.map(program => run(program));
void Promise.all(runs.filter((_, index) => !all[index].runsByItself)).then(() => othersAreThrough.resolve());
await Promise.all(runs);
console.error(describeTime());
if (programsWhoseFramesDiffer || programsMarkedForFramesAlone)
  console.error(
    `${programsWhoseFramesDiffer} builds differ from their reference in the frames of stack traces alone, and pass | ` +
      `${programsMarkedForFramesAlone} programs are skipped because a \`// Todo: only frames\` says that of them where this driver cannot tell`,
  );
if (programsWhoseReferenceWavered.size)
  console.error(
    `${programsWhoseReferenceWavered.size} programs pass though plain Bun printed otherwise at first: asked again it printed what the executable had printed: ` +
      [...programsWhoseReferenceWavered].join(" "),
  );
process.exit(hasFailed ? 1 : 0);
