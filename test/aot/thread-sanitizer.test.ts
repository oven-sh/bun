// The compiler's threads under ThreadSanitizer. ./repeated-builds.test.ts sees a race when it strikes, once in some hundred builds; ThreadSanitizer sees the two accesses
// whether or not they meet, in one build.
//
// The Bun under test writes each program as the engine reads it (`--aot-out`), and a `testaot` BUILT WITH -fsanitize=thread FROM THE SAME SOURCES compiles it on 16 threads.
// testaot and not Bun: in Bun the engine's loops run on the pool of the Rust half, whose locks ThreadSanitizer does not see, so every loop would be reported.
//
//   $TESTAOT_THREAD_SANITIZER    that testaot; or `testaot-thread-sanitizer` beside the Bun under test. Without it everything is skipped.
//   llvm-symbolizer              on $PATH, for the names in the reports
//
// A report is named by its kind and, for each of its two stacks, by the innermost function under aot/ and its file: no line numbers. Reports without such a frame are
// JavaScriptCore's and WTF's own. ./thread-sanitizer-known.json lists the races that are known today. A report that is not listed fails the test. The list only gets shorter:
//
//   AOT_THREAD_SANITIZER=shorten bun test test/aot/thread-sanitizer    takes out of the list what no program showed in this run (a race that was mended; look before you save it)
//   AOT_THREAD_SANITIZER=accept ..                                     writes the list as seen
import { afterAll, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { basename, dirname, join } from "path";
import { withProgramOutput } from "./harness/flags";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported";

const sanitized =
  process.env.TESTAOT_THREAD_SANITIZER ?? [join(dirname(bunExe()), "testaot-thread-sanitizer")].find(existsSync);
const skipped = !isLinux
  ? "ThreadSanitizer builds are made for Linux"
  : !sanitized
    ? "there is no testaot built with ThreadSanitizer: not in $TESTAOT_THREAD_SANITIZER, no testaot-thread-sanitizer beside the Bun under test"
    : undefined;
if (skipped) console.error(`SKIPPED: test/aot/thread-sanitizer.test.ts: ${skipped}`);

const mode = process.env.AOT_THREAD_SANITIZER;
const knownPath = join(import.meta.dir, "thread-sanitizer-known.json");
const known: string[] = JSON.parse(readFileSync(knownPath, "utf8"));
const seen = new Set<string>();
const threads = 16;

const programs: { path: string; flags?: string[] }[] = [
  { path: "programs/relational-summaries/accessors-arrive-on-the-chain-in-every-way.js" },
  // It pulls in enough of Bun's library to keep every thread busy, and it goes all the way through code generation and the image.
  { path: "programs/native-callbacks/callbacks-net-sockets-and-their-events.ts", flags: ["--target=bun"] },
  { path: "programs/small-benchmarks/tokens-maps-objects.ts" },
  { path: "programs/commonjs/typed-requires-typed/main.ts" },
];

// JavaScriptCore's and WTF's own, racy by design upstream: the collector, the traps of the VM, the options; the parking lot and the word locks order by their own atomics.
const suppressions = [
  "race:JSC::Heap::",
  "race:JSC::MarkedBlock",
  "race:JSC::VMTraps",
  "race:JSC::Options::",
  "race:WTF::ParkingLot",
  "race:WTF::WordLock",
];

const shortened = (name: string) =>
  name
    .replace(/\(.*/, "")
    .replaceAll("JSC::AOT::Typed::", "")
    .replaceAll("JSC::AOT::", "")
    .replaceAll("(anonymous namespace)::", "")
    .trim();
const inSources = (path: string) =>
  path.includes("/JavaScriptCore/") ? path.split("/JavaScriptCore/")[1] : basename(path);

/** The names of the reports in what ThreadSanitizer wrote. */
export function racesIn(log: string): string[] {
  const names: string[] = [];
  for (const report of log.split("WARNING: ThreadSanitizer:").slice(1)) {
    const kind = report.split("(pid")[0].trim();
    const sides: string[] = [];
    // The two accesses come first, each with its stack; then where the memory and the threads were made.
    for (const stack of report
      .slice(report.indexOf("\n") + 1)
      .split(/\n\n/)
      .filter(part => /^\s*(Previous )?(atomic )?(write|read) of size/i.test(part))
      .slice(0, 2)) {
      const frames = Array.from(stack.matchAll(/^\s+#\d+ (.*?) (\S+?):\d+(?::\d+)? \(/gm), ([, name, path]) => ({
        name: shortened(name),
        path: inSources(path),
      }));
      const ours = frames.find(frame => frame.path.startsWith("aot/"));
      if (ours) sides.push(`${ours.name} ${ours.path}`);
    }
    if (sides.length > 0) names.push(`${kind}: ${sides.sort().join(" | ")}`);
  }
  return names;
}

describe.skipIf(!!skipped)("compile/aot/thread sanitizer", () => {
  const folder = String(tempDir("aot-thread-sanitizer", { "suppressions.txt": suppressions.join("\n") + "\n" }));
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
    if (mode === "accept") writeFileSync(knownPath, JSON.stringify([...seen].sort(), null, 2) + "\n");
    if (mode === "shorten")
      writeFileSync(
        knownPath,
        JSON.stringify(
          known.filter(name => seen.has(name)),
          null,
          2,
        ) + "\n",
      );
  });

  test.each(programs)(
    "$path",
    async ({ path, flags = [] }) => {
      const source = join(import.meta.dir, path);
      const name = basename(dirname(source)) + "-" + basename(source).replace(/\.[a-z]+$/, "");
      const program = join(folder, `${name}.program`);
      built(
        await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...flags,
            withProgramOutput(program),
            source,
            "--outfile",
            join(folder, name),
          ],
          dirname(source),
          bunEnv,
        ),
      );
      rmSync(join(folder, name), { force: true });

      const options = [
        "halt_on_error=0",
        "report_signal_unsafe=0",
        "history_size=4",
        "exitcode=0",
        `log_path=${join(folder, name)}.reports`,
        `suppressions=${join(folder, "suppressions.txt")}`,
      ];
      await using compile = Bun.spawn({
        cmd: [sanitized!, "compile", program, `--output=${join(folder, name)}.image`, `threads=${threads}`],
        cwd: folder,
        env: { ...bunEnv, TSAN_OPTIONS: options.join(" ") },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        timeout: 1_500_000,
        killSignal: "SIGKILL",
      });
      await compile.exited;
      // testaot has no table of Bun's own built-ins, so most programs are stopped by the last verification in front of the back end. A signal is another matter.
      expect(compile.signalCode).toBeNull();

      const races = new Set(
        readdirSync(folder)
          .filter(file => file.startsWith(`${name}.reports`))
          .flatMap(file => racesIn(readFileSync(join(folder, file), "utf8"))),
      );
      for (const race of races) seen.add(race);
      console.error(
        `THREAD SANITIZER ${path}: ${races.size} different races under aot/, ${[...races].filter(race => !known.includes(race)).length} of them not known`,
      );
      if (mode !== "accept") expect([...races].filter(race => !known.includes(race)).sort()).toEqual([]);
    },
    1_800_000,
  );
});
