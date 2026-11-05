// The battery of the reach: the small programs that have caught a build leaving out something that the program needs.
//
// A build with --aot leaves out what the program does not reach: members of `Bun` and `process`, functions of Bun's own JavaScript, whole modules. Every rule that cuts more is a proof about programs, and a
// false proof shows in one shape of program and in no other. Each family here is one such shape, told over many names; most were written on the night when their fault was found.
//
//   bun run.ts [--jobs=32] [--kinds=closed,made-name] [--limit=400] [--part=1/6] [--whole-executables] [family ..]      the Bun that runs this file is the Bun that is asked
//
// Each program is built alone, as anybody builds it (`bun build --compile --aot <file> --outfile x`), three times:
//   closed      with nothing more
//   made-name   a load whose name the build cannot know stands in front of the text, and loads nothing. What a build holds of Bun's library goes by other rules there
//   open        with --aot-allow-code-from-disk
// and the executable is held against `bun <file> <arguments>`: the same arguments, environment and folder, both into a pipe.
//
// What is said of a program and a build:
//   as plain    the same standard output and exit code
//   refused     its head says `// Refused: <how the sentence begins>`, and the output holds that
//   refuses     it refuses aloud, by an error that a program can catch, what plain Bun does, and no head says that it may
//   stops       the build stops where plain Bun runs, and no head says `// Build stops: <text>`
//   wrong       another answer. Also a program that fails in plain Bun: a fault of the battery
//   dies        a signal, a timeout, "was left out of the executable", "This is a bug in Bun": whatever the head says
// All but the first two fail.
//
// This is a tool, as the fuzzers under ../fuzz are: some 8,000 builds, hours of processor time. No test file runs it. What it has caught stands in ../parallel, a program for each fault.
//
// A family is families/<name>.ts, whose default export writes the programs into a folder (a table of shapes, a table of names, one loop); or a folder of ../parallel that `foldersOfParallel` names, where a
// program is a file, or a folder with a main.*; or programs/<name>/ beside this file, if there is such a folder: more programs of that kind, which are not kept in the repository.
//
// A program may begin with comment lines, spelled as run-parallel.ts spells them where it has them:
//   // Flags: --no-builtin-modules     more flags for the build
//   // Env: NAME=value                 the environment of all runs, one variable a line
//   // Exit code: 3                    what plain Bun ends with
//   // Arguments: a b                  the arguments of both runs
//   // Arguments by: names.js          a file beside it: each line that plain Bun prints for it is one more argument
//   // Mask: [0-9]+                    what matches is taken out of both outputs: a port, a process id, the frames below an error
//   // Refused: Cannot load '          see above
//   // Build stops: TS100080           see above
//   // Closed alone | // Open alone    the other builds are not made
// and end with the comment of run-parallel.ts that says what the executable prints where that is not what plain Bun prints: /* Output: .. */. It counts as a refusal that the head allows.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Kind = "closed" | "made-name" | "open";
export type Word = "as plain" | "refused" | "refuses" | "stops" | "wrong" | "dies" | "no room" | "not run";
export type Verdict = { family: string; program: string; kind: Kind; word: Word; said: string };
export type Ended = { stdout: string; stderr: string; exitCode: number | null; signalCode?: string | null };
export type Start = (
  cmd: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  limit: number,
) => Promise<Ended>;

const here = import.meta.dir;
const kindsInOrder: Kind[] = ["closed", "made-name", "open"];
const endings = /\.(?:[cm]?js|[cm]?ts|tsx)$/;

/** Folders of test/aot/parallel whose programs belong to the battery too: there they are built closed, here in the two other ways as well. */
export const foldersOfParallel = [
  "tests-for-a-name",
  "methods-that-print-their-object",
  "built-ins-that-a-property-answers",
  "what-the-printer-asks-below-a-proxy-with-traps",
  "symbols-that-the-host-looks-under",
  "stores-by-rows-under-keys-nobody-knows",
  "texts-stepped-by-the-library-of-the-compiler",
  "errors-handed-to-handlers-of-sockets",
  "data-of-listeners-and-sockets",
  "what-operators-give-is-stored-into-the-environment",
  "lists-of-the-own-keys-of-a-holder",
  "members-read-off-what-a-made-name-loads",
  "objects-with-a-method-that-prints-them",
  "proxies-whose-traps-meet-the-printer",
  "records-that-met",
  "statics-read-off-the-species",
  "stores-into-the-environment-that-warn",
  "texts-that-spell-constructor",
  "the-main-module-by-odd-roads",
  "what-a-commonjs-entry-hands-the-host",
  "what-stands-above-an-instance",
];

const diesWhateverTheHeadSays = ["was left out of the executable", "This is a bug in Bun"];
// The note on every error by which an executable refuses what plain Bun does, and, for a program that prints the beginning of a message alone, how those sentences go.
const refusals = [
  "bun compile differs from bun run here",
  "compiled into this executable",
  "Cannot load '",
  "read-only in a compiled executable",
  "this executable only runs code that was compiled into it",
  "can't be used with this executable",
];

const loadsByAMadeName = {
  require: `try {\n  require(process.env.MADE_UP_MODULE_NAME ?? "./nothing-of-the-kind");\n} catch {}\n`,
  import: `import(process.env.MADE_UP_MODULE_NAME ?? "./nothing-of-the-kind").catch(() => {});\n`,
};

const startAlone: Start = async (cmd, cwd, env, limit) => {
  const child = Bun.spawn({
    cmd,
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: limit,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode: child.exitCode, signalCode: child.signalCode };
};

type Head = {
  flags: string[];
  env: Record<string, string>;
  exitCode: number;
  arguments: string[];
  argumentsBy?: string;
  masks: RegExp[];
  refused: string[];
  output?: string;
  stops: string[];
  kinds: Kind[];
};
function headOf(text: string): Head {
  const head: Head = {
    flags: [],
    env: {},
    exitCode: 0,
    arguments: [],
    masks: [],
    refused: [],
    stops: [],
    kinds: kindsInOrder,
  };
  for (const line of text.split("\n")) {
    if (!line.startsWith("//")) {
      if (line.trim()) break;
      continue;
    }
    const [, word, rest = ""] = /^\/\/ ([^:]*)(?:: ?(.*))?$/.exec(line) ?? [];
    if (word === "Flags") head.flags.push(...rest.split(" ").filter(Boolean));
    else if (word === "Env") head.env[rest.slice(0, rest.indexOf("="))] = rest.slice(rest.indexOf("=") + 1);
    else if (word === "Exit code") head.exitCode = Number(rest);
    else if (word === "Arguments") head.arguments.push(...rest.split(" ").filter(Boolean));
    else if (word === "Arguments by") head.argumentsBy = rest;
    else if (word === "Mask") head.masks.push(new RegExp(rest, "gm"));
    else if (word === "Refused") head.refused.push(rest);
    else if (word === "Build stops") head.stops.push(rest);
    else if (word === "Closed alone") head.kinds = ["closed"];
    else if (word === "Open alone") head.kinds = ["open"];
  }
  head.output = /\/\* Output:\n([^]*?)\*\/\s*$/.exec(text)?.[1];
  // The stored output is that of the closed build. Another build may refuse the same thing in other words of the same kind.
  head.refused.push(...refusals.filter(sentence => head.output?.includes(sentence)));
  return head;
}

/** Lays the program into `copy` with the load in front of its text. The entry keeps its name: another file of the program may ask for it. */
function layBesideAMadeName(copy: string, folder: string, entry: string, isFolder: boolean) {
  const text = readFileSync(join(folder, entry), "utf8");
  if (isFolder) cpSync(folder, copy, { recursive: true });
  else {
    mkdirSync(copy, { recursive: true });
    for (const name of readdirSync(folder))
      if (name !== entry && text.includes(name.replace(/\.[^.]*$/, "")))
        symlinkSync(join(folder, name), join(copy, name));
  }
  const lines = text.split("\n");
  let at = 0;
  while (
    at < lines.length &&
    (lines[at].startsWith("//") || !lines[at].trim() || /^["']use strict["'];?$/.test(lines[at].trim()))
  )
    at++;
  lines.splice(at, 0, loadsByAMadeName[/\.(?:mjs|mts|ts|tsx)$/.test(entry) ? "import" : "require"].trimEnd());
  writeFileSync(join(copy, entry), lines.join("\n"));
}

const short = (text: string, length = 200) =>
  text
    .split("\n")
    .filter(line => line.trim())
    .join(" ~ ")
    .slice(0, length);
const died = (ended: Ended) => ended.exitCode === null || ended.exitCode === 134 || !!ended.signalCode;
const endOf = (ended: Ended) => ended.signalCode ?? ended.exitCode;

export const isBad = (verdict: Verdict) => verdict.word !== "as plain" && verdict.word !== "refused";
export const lineOf = ({ family, program, kind, word, said }: Verdict) =>
  `${family}/${program}[${kind}] | ${word} | ${said.slice(0, 200)}`;

export type Options = {
  bun?: string;
  jobs?: number;
  env?: Record<string, string | undefined>;
  families?: string[];
  kinds?: Kind[];
  /** No build is begun behind so many seconds. Every closed build comes first, then those beside a made name, then the open ones. */
  limit?: number;
  /** [2, 6]: the second sixth of the programs. */
  part?: [number, number];
  moreFlags?: string[];
  /** Every build writes a whole executable, as anybody's build does. */
  wholeExecutables?: boolean;
  start?: Start;
  /** Called with each verdict as it falls. */
  heard?: (verdict: Verdict) => void;
};

export async function battery(options: Options = {}): Promise<Verdict[]> {
  const {
    bun = process.execPath,
    jobs = 32,
    families: asked = [],
    kinds = kindsInOrder,
    limit = 0,
    part,
    moreFlags = [],
    start = startAlone,
  } = options;
  const began = performance.now();
  // A job holds an executable and, while that is written, a copy of Bun. A disk that others share is never filled from here.
  const hasRoom = (folder: string) => {
    if (!existsSync(folder)) return false;
    const { bavail, bsize } = statfsSync(folder);
    return bavail * bsize > jobs * 1_200_000_000;
  };
  const place = ["/dev/shm", tmpdir()].find(hasRoom);
  if (!place)
    return [
      { family: "", program: "", kind: "closed", word: "no room", said: `no room for ${jobs} jobs in ${tmpdir()}` },
    ];
  const scratch = mkdtempSync(join(place, "reach-battery-"));
  // Whoever ends a run that takes too long finds nothing of it left.
  const leave = () => {
    rmSync(scratch, { recursive: true, force: true });
    process.exit(143);
  };
  process.on("SIGTERM", leave);
  process.on("SIGINT", leave);
  try {
    type Program = { family: string; program: string; folder: string; entry: string; isFolder: boolean };
    const programs: Program[] = [];
    const sources: [family: string, lay: (folder: string) => unknown][] = [
      ...readdirSync(join(here, "families"))
        .filter(name => name.endsWith(".ts"))
        .map((name): [string, (folder: string) => unknown] => [
          name.slice(0, -3),
          async folder => (await import(join(here, "families", name))).default(folder),
        ]),
      ...(existsSync(join(here, "programs")) ? readdirSync(join(here, "programs")) : []).map(
        (name): [string, (folder: string) => unknown] => [
          name,
          folder => cpSync(join(here, "programs", name), folder, { recursive: true }),
        ],
      ),
      ...foldersOfParallel
        .filter(name => existsSync(join(here, "..", "parallel", name)))
        .map((name): [string, (folder: string) => unknown] => [
          name,
          folder => cpSync(join(here, "..", "parallel", name), folder, { recursive: true }),
        ]),
    ];
    const unknown = asked.filter(name => !sources.some(([family]) => family === name));
    if (unknown.length)
      throw new Error(
        `no such family: ${unknown.join(", ")}. There are: ${sources
          .map(([family]) => family)
          .sort()
          .join(", ")}`,
      );
    // A family may lie in two places: what has turned red once is a stored program of ../parallel, its sisters lie in programs/.
    for (const family of [...new Set(sources.map(([family]) => family))].sort()) {
      if (asked.length && !asked.includes(family)) continue;
      const folder = join(scratch, "families", family);
      mkdirSync(folder, { recursive: true });
      for (const [name, lay] of sources) if (name === family) await lay(folder);
      for (const name of readdirSync(folder).sort()) {
        const path = join(folder, name);
        if (statSync(path).isDirectory()) {
          const entry = readdirSync(path).find(file => file.startsWith("main.") && endings.test(file));
          if (entry) programs.push({ family, program: name, folder: path, entry, isFolder: true });
        } else if (endings.test(name) && !name.startsWith("names--"))
          programs.push({ family, program: name, folder, entry: name, isFolder: false });
      }
    }
    // A part is a run of neighbors with its share of the builds: what is wrong with one family fails one part or two, not all.
    const buildsOf = programs.map(
      ({ folder, entry }) =>
        headOf(readFileSync(join(folder, entry), "utf8")).kinds.filter(kind => kinds.includes(kind)).length,
    );
    const allBuilds = buildsOf.reduce((sum, builds) => sum + builds, 0);
    let before = 0;
    const mine = programs.filter((_, index) => {
      const at = before;
      before += buildsOf[index];
      return !part || Math.floor((at * part[1]) / allBuilds) === part[0] - 1;
    });

    async function inParallel<T, R>(work: T[], one: (item: T) => Promise<R>): Promise<R[]> {
      const results = new Array<R>(work.length);
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(jobs, work.length) }, async () => {
          while (next < work.length) {
            const index = next++;
            results[index] = await one(work[index]);
          }
        }),
      );
      return results;
    }

    type Known = Program & {
      head: Head;
      env: Record<string, string | undefined>;
      arguments: string[];
      plain?: Ended;
      fault?: string;
    };
    const known = await inParallel(mine, async (program): Promise<Known> => {
      const head = headOf(readFileSync(join(program.folder, program.entry), "utf8"));
      const env = {
        ...(options.env ?? process.env),
        NO_COLOR: "1",
        BUN_DEBUG_QUIET_LOGS: "1",
        BUN_ENABLE_CRASH_REPORTING: "0",
        ...head.env,
      };
      const all = { ...program, head, env, arguments: [...head.arguments] };
      if (head.argumentsBy) {
        const listed = await start([bun, head.argumentsBy], program.folder, env, 40_000);
        if (listed.exitCode !== 0 || !listed.stdout.trim())
          return { ...all, fault: `plain Bun cannot say the arguments: ${short(listed.stdout + listed.stderr)}` };
        all.arguments.push(...listed.stdout.split(/\s+/).filter(Boolean));
      }
      const plain = await start([bun, program.entry, ...all.arguments], program.folder, env, 60_000);
      if (plain.exitCode !== head.exitCode)
        return { ...all, fault: `plain Bun ends with ${endOf(plain)}: ${short(plain.stdout + plain.stderr)}` };
      return { ...all, plain };
    });

    const builds = kindsInOrder
      .filter(kind => kinds.includes(kind))
      .flatMap(kind => known.filter(({ head }) => head.kinds.includes(kind)).map(program => ({ ...program, kind })));
    return await inParallel(
      builds,
      async ({
        family,
        program,
        folder: written,
        entry,
        isFolder,
        kind,
        head,
        env,
        arguments: given,
        plain,
        fault,
      }): Promise<Verdict> => {
        const say = (word: Word, said = ""): Verdict => {
          const verdict = { family, program, kind, word, said };
          options.heard?.(verdict);
          return verdict;
        };
        if (fault || !plain) return say("wrong", fault);
        if (limit && performance.now() - began > limit * 1000) return say("not run");
        const made = join(scratch, `${family}-${program}-${kind}`.replace(/\W/g, "_"));
        try {
          const folder = kind === "made-name" ? join(scratch, "beside-a-made-name", family, program) : written;
          if (kind === "made-name") layBesideAMadeName(folder, written, entry, isFolder);
          // An executable is a copy of Bun with the program behind it, and writing the copy is half of what a small build costs the machine. The build writes the program alone, as under
          // run-parallel.ts: the compile is the same, and the file starts as the executable would. A program that asks about its own file gets the executable.
          const asksAboutItsFile = /\bexecPath\b|\bargv0\b|\bargv\[0\]/.test(readFileSync(join(folder, entry), "utf8"));
          const writesProgramAlone = process.platform === "linux" && !options.wholeExecutables && !asksAboutItsFile;
          const build = await start(
            [
              bun,
              "build",
              "--compile",
              ...moreFlags,
              "--aot",
              ...(kind === "open" ? ["--aot-allow-code-from-disk"] : []),
              ...head.flags,
              entry,
              "--outfile",
              made,
            ],
            folder,
            writesProgramAlone
              ? { ...env, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1", BUN_AOT_WRITES_PROGRAM_ALONE: "1" }
              : env,
            240_000,
          );
          const printed = build.stdout + build.stderr;
          if (/ENOSPC|No space left on device/.test(printed)) return say("no room", "the disk is full");
          if (build.exitCode !== 0 || !existsSync(made)) {
            const errorsFirst = printed
              .split("\n")
              .sort((a, b) => Number(b.startsWith("error")) - Number(a.startsWith("error")));
            const mayStop =
              !died(build) &&
              head.stops.some(stop => printed.includes(stop)) &&
              !diesWhateverTheHeadSays.some(sentence => printed.includes(sentence));
            return say(
              mayStop ? "refused" : "stops",
              `the build ends with ${endOf(build)}: ${short(errorsFirst.join("\n"))}`,
            );
          }
          const ran = await start([made, ...given], folder, env, 60_000);
          const both = ran.stdout + ran.stderr;
          const masked = (output: string) =>
            [...head.masks, /(?<=localhost|127\.0\.0\.1|\[::1\]):\d+/g].reduce(
              (left, mask) => left.replace(mask, ""),
              output,
            );
          if (died(ran) || diesWhateverTheHeadSays.some(sentence => both.includes(sentence)))
            return say("dies", `ends with ${endOf(ran)}: ${short(ran.stderr + ran.stdout)}`);
          if (ran.exitCode === plain.exitCode && masked(ran.stdout) === masked(plain.stdout)) return say("as plain");
          if (head.refused.some(sentence => both.includes(sentence))) return say("refused");
          const named = ran.stderr.split("\n").find(line => /^(error|[A-Za-z]*Error)\b/.test(line)) ?? "";
          if (head.output === ran.stdout + (ran.exitCode ? `exit code ${ran.exitCode}\n${named}\n` : ran.stderr)) return say("refused");
          const inPlain = plain.stdout + plain.stderr;
          const heard = refusals.filter(sentence => both.includes(sentence) && !inPlain.includes(sentence));
          if (heard.length)
            return say(
              "refuses",
              `ends with ${ran.exitCode}: ${short(
                both
                  .split("\n")
                  .filter(line => heard.some(sentence => line.includes(sentence)))
                  .join("\n"),
              )}`,
            );
          return say(
            "wrong",
            `ends with ${ran.exitCode}, plain Bun with ${plain.exitCode}: ${short(both, 110)} | PLAIN: ${short(plain.stdout, 80)}`,
          );
        } finally {
          // An executable is as large as Bun, and taking it away takes tens of milliseconds: not on this thread, which starts every other job.
          await rm(made, { force: true });
        }
      },
    );
  } finally {
    process.off("SIGTERM", leave);
    process.off("SIGINT", leave);
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const flag = (name: string) => process.argv.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
  const began = performance.now();
  const verdicts = await battery({
    jobs: Number(flag("jobs") ?? 32),
    kinds: flag("kinds")?.split(",") as Kind[] | undefined,
    limit: Number(flag("limit") ?? 0),
    part: flag("part")?.split("/").map(Number) as [number, number] | undefined,
    moreFlags: flag("threads") ? [`--aot-threads=${flag("threads")}`] : [],
    wholeExecutables: process.argv.includes("--whole-executables"),
    // What is bad is said at once on the standard error, for whoever watches a long run; the lines that count come at the end.
    heard: verdict => isBad(verdict) && verdict.word !== "not run" && console.error(`now: ${lineOf(verdict)}`),
    families: process.argv.slice(2).filter(word => !word.startsWith("--")),
  });
  const count = (list: Verdict[], ...words: Word[]) => list.filter(({ word }) => words.includes(word)).length;
  const seconds = ((performance.now() - began) / 1000).toFixed(0);
  if (count(verdicts, "no room")) {
    console.log(
      `reach-battery: NO ROOM: the disk was full for ${count(verdicts, "no room")} of ${verdicts.length} builds: this run says nothing`,
    );
    process.exit(2);
  }
  for (const family of new Set(verdicts.map(({ family }) => family))) {
    const own = verdicts.filter(verdict => verdict.family === family);
    console.log(
      `${family} ${count(own, "as plain")} | ${count(own, "refused")} | ${count(own, "refuses", "stops", "wrong", "dies")}`,
    );
  }
  const bad = verdicts.filter(verdict => isBad(verdict) && verdict.word !== "not run");
  for (const verdict of bad) console.log(`reach-battery-bad ${lineOf(verdict)}`);
  const notRun = count(verdicts, "not run");
  console.log(
    `ALL ${verdicts.length} | red ${bad.length} | ${seconds} s: as plain ${count(verdicts, "as plain")} | refused as its head says ${count(verdicts, "refused")} | REFUSES ALOUD where no head says so ${count(verdicts, "refuses")} | DIES ${count(verdicts, "dies")} | STOPS ${count(verdicts, "stops")} | WRONG ${count(verdicts, "wrong")}${notRun ? ` | NOT RUN ${notRun}: the limit ran out` : ""}`,
  );
  console.log(
    `reach-battery: ${verdicts.length} programs | as plain ${count(verdicts, "as plain", "refused")} | dies ${count(verdicts, "dies")} | stops ${count(verdicts, "stops")} | wrong ${count(verdicts, "wrong")} | in ${seconds} s`,
  );
  process.exit(bad.length ? 1 : 0);
}
